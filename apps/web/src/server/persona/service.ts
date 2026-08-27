import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  decodeJsonColumn,
  personaSnapshotSchema,
  type AuthenticatedUser,
  type PersonaSnapshot,
} from "@prizgram/shared";
import {
  personaIntakes,
  personaIntakeAnswers,
  personaVersions,
  type DatabaseConnection,
} from "@prizgram/db";
import {
  createLlmClientFromEnvironment,
  LlmClientError,
  personaStructuredOutput,
  type ChatMessage,
  type StructuredLlmClient,
} from "@/server/llm";

import { AppError } from "../api";
import { PERSONA_INTAKE_QUESTION_IDS } from "./questions";

export const PERSONA_PROMPT_VERSION = "persona-v1";
const INTAKE_SOURCE_PREFIX = "persona-intake:";

/**
 * Stale threshold for a completed intake without a persona version.
 * Uses the LLM timeout plus a conservative margin so a live generation
 * is not reclaimed while a recently crashed one becomes retriable.
 */
export function personaGenerationStaleMs(): number {
  const raw = process.env.OPENAI_TIMEOUT_MS ?? "30000";
  const parsed = Number(raw);
  const timeoutMs =
    Number.isInteger(parsed) && parsed >= 100 && parsed <= 120_000
      ? parsed
      : 30000;
  return timeoutMs + 30_000;
}

export const personaGenerateRequestSchema = z
  .object({
    intakeId: z.string().trim().min(1).max(128),
    /** Client-generated id recorded in provenance for traceability. */
    requestId: z.string().trim().min(8).max(128).optional(),
  })
  .strict();

export const personaAnswerRequestSchema = z
  .object({
    questionId: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,64}$/),
    answer: z.string().trim().min(1).max(4_000),
  })
  .strict();

export type PersonaGenerateInput = z.infer<typeof personaGenerateRequestSchema>;
export type PersonaAnswerInput = z.infer<typeof personaAnswerRequestSchema>;

export type IntakeState = Readonly<{
  intakeId: string;
  status: "in_progress" | "completed";
  answers: Readonly<Record<string, string>>;
}>;

export type GeneratedPersona = Readonly<{
  personaVersionId: string;
  version: number;
  duplicate: boolean;
}>;

export type PersonaVersionMeta = Readonly<{
  personaVersionId: string;
  version: number;
  createdAt: string;
  model?: string;
  promptVersion?: string;
}>;

export type PersonaLatest = PersonaVersionMeta &
  Readonly<{
    snapshot: PersonaSnapshot;
  }>;

type GenerateOptions = Readonly<{
  client?: StructuredLlmClient;
  model?: string;
  now?: () => Date;
}>;

let environmentClient: StructuredLlmClient | undefined;

function defaultClient(): StructuredLlmClient {
  environmentClient ??= (() => {
    try {
      return createLlmClientFromEnvironment();
    } catch (error) {
      throw new AppError(
        "SERVER_MISCONFIGURED",
        "The language model client is not configured",
        500,
        undefined,
        undefined,
        { cause: error },
      );
    }
  })();
  return environmentClient;
}

function upstreamError(error: unknown): AppError {
  if (error instanceof LlmClientError) {
    return new AppError(
      error.retryable ? "UPSTREAM_UNAVAILABLE" : "UPSTREAM_INVALID_RESPONSE",
      "The persona could not be generated right now",
      502,
      undefined,
      undefined,
      { cause: error },
    );
  }
  throw error;
}

export class PersonaService {
  constructor(private readonly connection: DatabaseConnection) {}

  startIntake(userId: string): IntakeState {
    const existing = this.connection.db
      .select({ id: personaIntakes.id })
      .from(personaIntakes)
      .where(
        and(
          eq(personaIntakes.userId, userId),
          eq(personaIntakes.status, "in_progress"),
        ),
      )
      .get();
    let intakeId: string;
    if (existing !== undefined) {
      intakeId = existing.id;
    } else {
      intakeId = randomUUID();
      this.connection.db
        .insert(personaIntakes)
        .values({ id: intakeId, userId })
        .run();
    }
    const answers: Record<string, string> = {};
    for (const row of this.loadAnswers(userId, intakeId)) {
      answers[row.questionId] = row.answer;
    }
    return { intakeId, status: "in_progress", answers };
  }

  getIntake(userId: string, intakeId: string): IntakeState {
    const intake = this.loadIntake(userId, intakeId);
    const answers: Record<string, string> = {};
    for (const row of this.loadAnswers(userId, intake.id)) {
      answers[row.questionId] = row.answer;
    }
    return {
      intakeId: intake.id,
      status: intake.status,
      answers,
    };
  }

  saveAnswer(
    user: AuthenticatedUser,
    intakeId: string,
    input: PersonaAnswerInput,
  ): void {
    const intake = this.loadIntake(user.id, intakeId);
    if (intake.status !== "in_progress") {
      throw new AppError("CONFLICT", "This intake is already completed", 409);
    }
    const now = new Date();
    // Upsert on (intake_id, question_id): concurrent saves cannot violate
    // the unique index, and the stable answer id survives overwrites so
    // evidence references keep pointing at the same row.
    this.connection.db
      .insert(personaIntakeAnswers)
      .values({
        id: randomUUID(),
        userId: user.id,
        intakeId: intake.id,
        questionId: input.questionId,
        answer: input.answer,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          personaIntakeAnswers.intakeId,
          personaIntakeAnswers.questionId,
        ],
        set: { answer: input.answer, updatedAt: now },
      })
      .run();
    this.connection.db
      .update(personaIntakes)
      .set({ updatedAt: now })
      .where(eq(personaIntakes.id, intake.id))
      .run();
  }

  /**
   * Generates one immutable persona version from a fully answered intake.
   * Idempotency: an intake yields exactly one version; retried calls return
   * the stored version instead of regenerating.
   */
  async generatePersona(
    user: AuthenticatedUser,
    input: PersonaGenerateInput,
    options: GenerateOptions = {},
  ): Promise<GeneratedPersona> {
    const client = options.client ?? defaultClient();
    const model = options.model ?? process.env.OPENAI_MODEL ?? null;
    const now = options.now ?? (() => new Date());
    const intakeSourceId = `${INTAKE_SOURCE_PREFIX}${input.intakeId}`;

    const intake = this.loadIntake(user.id, input.intakeId);

    const duplicate = this.findVersionByIntake(user.id, intakeSourceId);
    if (duplicate !== undefined) {
      return { ...duplicate, duplicate: true };
    }

    const answers = this.loadAnswers(user.id, intake.id);
    const byQuestion = new Map(
      answers.map((row) => [row.questionId, row] as const),
    );
    const missing = PERSONA_INTAKE_QUESTION_IDS.filter(
      (questionId) => !byQuestion.has(questionId),
    );
    if (missing.length > 0) {
      throw new AppError(
        "INTAKE_INCOMPLETE",
        "All six questions must be answered before generating",
        400,
      );
    }

    // Completed without a persona version means a prior claim never
    // produced a version (e.g. process crash). A fresh claim must not be
    // reclaimed immediately while the original LLM request may still be
    // running; only stale claims become retriable (#202).
    if (intake.status === "completed") {
      const ageMs = now().getTime() - new Date(intake.updatedAt).getTime();
      const staleMs = personaGenerationStaleMs();
      if (ageMs < staleMs) {
        throw new AppError(
          "CONFLICT",
          "Generation already completed or in progress for this intake",
          409,
        );
      }
      // Stale claim: bump updatedAt atomically so only one retrier wins.
      const reclaimed = this.connection.db
        .update(personaIntakes)
        .set({ updatedAt: now() })
        .where(
          and(
            eq(personaIntakes.id, intake.id),
            eq(personaIntakes.status, "completed"),
            eq(personaIntakes.updatedAt, intake.updatedAt),
          ),
        )
        .run();
      if (reclaimed.changes !== 1) {
        throw new AppError(
          "CONFLICT",
          "Generation already completed or in progress for this intake",
          409,
        );
      }
      const duplicateAfterReclaim = this.findVersionByIntake(
        user.id,
        intakeSourceId,
      );
      if (duplicateAfterReclaim !== undefined) {
        return { ...duplicateAfterReclaim, duplicate: true };
      }
    } else {
      // Atomically claim the intake so parallel generations cannot both write.
      const claimed = this.connection.db
        .update(personaIntakes)
        .set({ status: "completed", updatedAt: now() })
        .where(
          and(
            eq(personaIntakes.id, intake.id),
            eq(personaIntakes.status, "in_progress"),
          ),
        )
        .run();
      if (claimed.changes !== 1) {
        throw new AppError(
          "CONFLICT",
          "Generation already completed or in progress for this intake",
          409,
        );
      }
    }

    try {
      const messages = buildPersonaMessages(answers);
      let snapshot: PersonaSnapshot;
      try {
        snapshot = await client.generateStructured({
          messages,
          output: personaStructuredOutput,
          schemaName: "persona_snapshot",
        });
      } catch (error) {
        throw upstreamError(error);
      }
      snapshot = this.rewriteEvidenceToIntake(user.id, intake.id, snapshot);

      const generatedAt = now().toISOString();
      let insertedVersion: number | undefined;
      for (
        let attempt = 0;
        attempt < 2 && insertedVersion === undefined;
        attempt += 1
      ) {
        const version = this.nextVersionNumber(user.id);
        try {
          this.connection.db
            .insert(personaVersions)
            .values({
              id: randomUUID(),
              userId: user.id,
              version,
              snapshot,
              ...(model === null ? {} : { model }),
              promptVersion: PERSONA_PROMPT_VERSION,
              provenance: {
                source: "llm" as const,
                sourceIds: [
                  intakeSourceId,
                  ...(input.requestId === undefined ? [] : [input.requestId]),
                ],
                generatedAt,
                ...(model === null ? {} : { model }),
                promptVersion: PERSONA_PROMPT_VERSION,
              },
            })
            .run();
          insertedVersion = version;
        } catch (error) {
          // Unique (user_id, version): another writer won the race; recompute once.
          const code =
            typeof error === "object" && error !== null && "code" in error
              ? (error as { code?: unknown }).code
              : undefined;
          if (
            attempt === 0 &&
            typeof code === "string" &&
            code.startsWith("SQLITE_CONSTRAINT")
          )
            continue;
          throw error;
        }
      }
      if (insertedVersion === undefined) {
        throw new AppError("CONFLICT", "Persona generation raced", 409);
      }
      const stored = this.findVersionByIntake(user.id, intakeSourceId);
      if (stored === undefined) {
        throw new AppError(
          "INTERNAL_ERROR",
          "Persona row missing after insert",
          500,
        );
      }
      return {
        personaVersionId: stored.personaVersionId,
        version: stored.version,
        duplicate: false,
      };
    } catch (error) {
      // Release the claim so the user can retry after a transient failure.
      this.connection.db
        .update(personaIntakes)
        .set({ status: "in_progress", updatedAt: now() })
        .where(
          and(
            eq(personaIntakes.id, intake.id),
            eq(personaIntakes.status, "completed"),
          ),
        )
        .run();
      throw error;
    }
  }

  latestPersona(userId: string): PersonaLatest | undefined {
    const rows = this.listVersions(userId);
    const latest = rows[0];
    if (latest === undefined) return undefined;
    const raw = this.connection.sqlite
      .prepare("select snapshot from persona_versions where id = ?")
      .get(latest.personaVersionId) as { snapshot: string } | undefined;
    if (raw === undefined) return undefined;
    return {
      ...latest,
      snapshot: decodeJsonColumn(
        "persona_versions.snapshot",
        personaSnapshotSchema,
        raw.snapshot,
      ),
    };
  }

  listVersions(userId: string): PersonaVersionMeta[] {
    const rows = this.connection.db
      .select()
      .from(personaVersions)
      .where(eq(personaVersions.userId, userId))
      .all();
    rows.sort((a, b) => b.version - a.version);
    return rows.map((row) => ({
      personaVersionId: row.id,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      ...(row.model === null ? {} : { model: row.model }),
      ...(row.promptVersion === null
        ? {}
        : { promptVersion: row.promptVersion }),
    }));
  }

  private loadIntake(userId: string, intakeId: string) {
    const intake = this.connection.db
      .select()
      .from(personaIntakes)
      .where(
        and(eq(personaIntakes.id, intakeId), eq(personaIntakes.userId, userId)),
      )
      .get();
    if (intake === undefined) {
      throw new AppError("NOT_FOUND", "Intake not found", 404);
    }
    return intake;
  }

  private loadAnswers(userId: string, intakeId: string) {
    return this.connection.db
      .select()
      .from(personaIntakeAnswers)
      .where(
        and(
          eq(personaIntakeAnswers.userId, userId),
          eq(personaIntakeAnswers.intakeId, intakeId),
        ),
      )
      .all();
  }

  private findVersionByIntake(userId: string, intakeSourceId: string) {
    const rows = this.listVersions(userId);
    for (const meta of rows) {
      const provenance = this.loadProvenance(meta.personaVersionId);
      if (provenance.sourceIds.includes(intakeSourceId)) return meta;
    }
    return undefined;
  }

  private loadProvenance(personaVersionId: string) {
    const raw = this.connection.sqlite
      .prepare("select provenance from persona_versions where id = ?")
      .get(personaVersionId) as { provenance: string } | undefined;
    const fallback = {
      source: "system" as const,
      sourceIds: [],
      generatedAt: "",
    };
    if (raw === undefined) return fallback;
    return decodeProvenance(raw.provenance) ?? fallback;
  }

  private nextVersionNumber(userId: string): number {
    const max = this.connection.sqlite
      .prepare(
        "select max(version) as value from persona_versions where user_id = ?",
      )
      .get(userId) as { value: number | null };
    return Number(max.value ?? 0) + 1;
  }

  /**
   * Context-dependent validation required by the issue: initial evidence is
   * limited to user_input and every sourceId must be an actual answer row id.
   * The provider only knows the public question ids, so they are rewritten to
   * the stored answer ids here; anything unknown rejects the whole generation.
   */
  private rewriteEvidenceToIntake(
    userId: string,
    intakeId: string,
    snapshot: PersonaSnapshot,
  ): PersonaSnapshot {
    const answerRows = this.loadAnswers(userId, intakeId);
    const answerIdByQuestion = new Map(
      answerRows.map((row) => [row.questionId, row.id] as const),
    );

    const rewrittenEvidence = snapshot.evidence.map((evidence) => {
      if (evidence.sourceType !== "user_input") {
        throw new AppError(
          "UPSTREAM_INVALID_RESPONSE",
          "Initial persona evidence must reference the user's own answers",
          502,
        );
      }
      if (evidence.sourceId === undefined) {
        throw new AppError(
          "UPSTREAM_INVALID_RESPONSE",
          "Initial persona evidence must cite an intake answer",
          502,
        );
      }
      const answerId = answerIdByQuestion.get(evidence.sourceId);
      if (answerId === undefined) {
        throw new AppError(
          "UPSTREAM_INVALID_RESPONSE",
          `Unknown evidence source: ${evidence.sourceId}`,
          502,
        );
      }
      return { ...evidence, sourceId: answerId };
    });

    return personaSnapshotSchema.parse({
      ...snapshot,
      evidence: rewrittenEvidence,
    });
  }
}

/** Decodes provenance defensively for idempotency lookups. */
function decodeProvenance(
  raw: string,
): { source: string; sourceIds: string[]; generatedAt: string } | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as { sourceIds?: unknown }).sourceIds)
    ) {
      return parsed as {
        source: string;
        sourceIds: string[];
        generatedAt: string;
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function buildPersonaMessages(
  answers: ReadonlyArray<{ questionId: string; answer: string }>,
): readonly ChatMessage[] {
  const blocks = answers.map(
    ({ questionId, answer }) =>
      `<answer id="${questionId}">\n${answer}\n</answer>`,
  );
  return [
    {
      role: "system",
      content: [
        "あなたは就活支援アシスタントです。ユーザーの回答から構造化ペルソナを抽出します。",
        "ルール:",
        '- 各evidenceは必ず sourceType を "user_input" にし、sourceId には',
        "  回答ブロックの id 属性（例: q1_skills）をそのまま使ってください。",
        "- skills / experiences の evidenceRefs には、定義済み evidence の id を引用してください。",
        "- 回答に無い事実を推測で追加しないでください。該当が無い項目は空配列にしてください。",
        "- confidence は回答の具体性に基づく0〜1の値にしてください。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "以下の6つの回答からペルソナを構造化してください。",
        ...blocks,
      ].join("\n\n"),
    },
  ];
}
