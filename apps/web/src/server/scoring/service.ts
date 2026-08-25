import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  createScoringStructuredOutput,
  type AuthenticatedUser,
} from "@prizgram/shared";
import {
  jobVersions,
  matchScores,
  personaVersions,
  type DatabaseConnection,
} from "@prizgram/db";
import { type JobSnapshot, type PersonaSnapshot } from "@prizgram/shared";

import { AppError } from "../api";
import {
  LlmClientError,
  OpenAiCompatibleClient,
  type StructuredLlmClient,
} from "@/server/llm";

export const SCORING_PROMPT_VERSION = "scoring-v1";

export const scoringRequestSchema = z
  .object({
    jobId: z.string().trim().min(1).max(128).optional(),
    /** Explicit re-evaluation target; defaults to the latest versions. */
    personaVersionId: z.string().trim().min(1).max(128).optional(),
    jobVersionId: z.string().trim().min(1).max(128).optional(),
    requestId: z.string().trim().min(8).max(128).optional(),
  })
  .strict();

export type ScoringInput = z.infer<typeof scoringRequestSchema>;

export type ScoreResult = Readonly<{
  scoreId: string;
  duplicate: boolean;
  axes: {
    skillFit: { score: number };
    cultureValueFit: { score: number };
    difficultyGap: { score: number };
  };
}>;

let environmentClient: StructuredLlmClient | undefined;

function defaultClient() {
  environmentClient ??= (() => {
    try {
      return new OpenAiCompatibleClient({
        baseUrl: process.env.OPENAI_BASE_URL ?? "",
        apiKey: process.env.OPENAI_API_KEY ?? "",
        model: process.env.OPENAI_MODEL ?? "",
        timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? "30000"),
      });
    } catch (error) {
      throw new AppError(
        "SERVER_MISCONFIGURED",
        "The language model client is not configured",
        500,
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
      "The scoring could not be produced right now",
      502,
      undefined,
      { cause: error },
    );
  }
  throw error;
}

interface LoadedRow {
  id: string;
  version: number;
  persona?: PersonaSnapshot;
  job?: JobSnapshot;
}

export class ScoringService {
  constructor(private readonly connection: DatabaseConnection) {}

  /**
   * Scores one (persona version, job version) pair on three axes with
   * evidence references validated against the union of both sides. Identical
   * generation conditions dedupe to the stored row.
   */
  async score(
    user: AuthenticatedUser,
    input: ScoringInput,
    options: { client?: StructuredLlmClient; model?: string } = {},
  ): Promise<ScoreResult> {
    const client = options.client ?? defaultClient();
    const persona = this.loadPersona(user.id, input.personaVersionId);
    const job = this.loadJobVersion(user.id, input.jobId, input.jobVersionId);

    const pSnap = persona.persona;
    const jSnap = job.job;
    if (pSnap === undefined || jSnap === undefined) {
      throw new AppError("NOT_FOUND", "Snapshot missing", 404);
    }
    const allowedRefs = new Set<string>([
      ...pSnap.evidence.map((e) => e.id),
      ...jSnap.requirements.map((s) => s.id),
      ...jSnap.desiredSkills.map((s) => s.id),
      ...jSnap.cultureValues.map((s) => s.id),
    ]);
    const contract = createScoringStructuredOutput(allowedRefs);

    // Duplicate check under identical generation conditions.
    const existing = this.connection.db
      .select()
      .from(matchScores)
      .where(
        and(
          eq(matchScores.userId, user.id),
          eq(matchScores.personaVersionId, persona.id),
          eq(matchScores.jobVersionId, job.id),
          eq(matchScores.model, process.env.OPENAI_MODEL ?? "test-model"),
          eq(matchScores.promptVersion, SCORING_PROMPT_VERSION),
        ),
      )
      .get();
    if (existing !== undefined) {
      return {
        scoreId: existing.id,
        duplicate: true,
        axes: {
          skillFit: { score: existing.skillFitScore },
          cultureValueFit: { score: existing.cultureValueFitScore },
          difficultyGap: { score: existing.difficultyGapScore },
        },
      };
    }

    const messages = buildScoringMessages(pSnap, jSnap);
    let output: { [k: string]: unknown };
    try {
      output = await client.generateStructured({
        messages,
        output: contract,
        schemaName: "job_scoring",
      });
    } catch (error) {
      throw upstreamError(error);
    }

    const model = options.model ?? process.env.OPENAI_MODEL ?? "test-model";
    const scoreId = randomUUID();
    try {
      this.connection.db
        .insert(matchScores)
        .values({
          id: scoreId,
          userId: user.id,
          personaVersionId: persona.id,
          jobVersionId: job.id,
          skillFitScore: (output.skillFit as { score: number }).score,
          skillFitReasons: (output.skillFit as { reasons: string[] }).reasons,
          skillFitEvidenceRefs: (output.skillFit as { evidenceRefs: string[] })
            .evidenceRefs,
          cultureValueFitScore: (output.cultureValueFit as { score: number })
            .score,
          cultureValueFitReasons: (
            output.cultureValueFit as { reasons: string[] }
          ).reasons,
          cultureValueFitEvidenceRefs: (
            output.cultureValueFit as { evidenceRefs: string[] }
          ).evidenceRefs,
          difficultyGapScore: (output.difficultyGap as { score: number }).score,
          difficultyGapReasons: (output.difficultyGap as { reasons: string[] })
            .reasons,
          difficultyGapEvidenceRefs: (
            output.difficultyGap as { evidenceRefs: string[] }
          ).evidenceRefs,
          model,
          promptVersion: SCORING_PROMPT_VERSION,
        })
        .run();
    } catch (error) {
      // Unique generation conditions raced: treat the stored row as result.
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT")) {
        const winner = this.connection.db
          .select()
          .from(matchScores)
          .where(eq(matchScores.id, scoreId))
          .get();
        if (winner === undefined) {
          const any = this.connection.db
            .select()
            .from(matchScores)
            .where(
              and(
                eq(matchScores.userId, user.id),
                eq(matchScores.personaVersionId, persona.id),
                eq(matchScores.jobVersionId, job.id),
              ),
            )
            .get();
          if (any !== undefined) {
            return {
              scoreId: any.id,
              duplicate: true,
              axes: {
                skillFit: { score: any.skillFitScore },
                cultureValueFit: { score: any.cultureValueFitScore },
                difficultyGap: { score: any.difficultyGapScore },
              },
            };
          }
        }
      }
      throw error;
    }

    return {
      scoreId,
      duplicate: false,
      axes: {
        skillFit: { score: (output.skillFit as { score: number }).score },
        cultureValueFit: {
          score: (output.cultureValueFit as { score: number }).score,
        },
        difficultyGap: {
          score: (output.difficultyGap as { score: number }).score,
        },
      },
    };
  }

  latestForJob(userId: string, jobId: string) {
    const rows = this.connection.sqlite
      .prepare(
        `select ms.*, pv.version as persona_version, jv.version as job_version
         from match_scores ms
         join persona_versions pv on pv.id = ms.persona_version_id
         join job_versions jv on jv.id = ms.job_version_id
         where ms.user_id = ? and jv.job_id = ?
         order by ms.created_at desc limit 1`,
      )
      .all(userId, jobId) as Array<Record<string, unknown>>;
    return rows[0];
  }

  private loadPersona(userId: string, versionId?: string): LoadedRow {
    const row =
      versionId === undefined
        ? this.connection.db
            .select()
            .from(personaVersions)
            .where(eq(personaVersions.userId, userId))
            .all()
            .sort((a, b) => b.version - a.version)[0]
        : this.connection.db
            .select()
            .from(personaVersions)
            .where(
              and(
                eq(personaVersions.id, versionId),
                eq(personaVersions.userId, userId),
              ),
            )
            .get();
    if (row === undefined) {
      throw new AppError("NOT_FOUND", "Persona not found", 404);
    }
    return {
      id: row.id,
      version: row.version,
      persona: row.snapshot,
    };
  }

  private loadJobVersion(
    userId: string,
    jobId?: string,
    versionId?: string,
  ): LoadedRow {
    let row:
      | { id: string; version: number; jobId: string; snapshot: unknown }
      | undefined;
    if (versionId !== undefined) {
      row = this.connection.db
        .select()
        .from(jobVersions)
        .where(
          and(eq(jobVersions.id, versionId), eq(jobVersions.userId, userId)),
        )
        .get();
    } else if (jobId !== undefined) {
      const all = this.connection.db
        .select()
        .from(jobVersions)
        .where(
          and(eq(jobVersions.jobId, jobId), eq(jobVersions.userId, userId)),
        )
        .all();
      row = all.sort((a, b) => b.version - a.version)[0];
    }
    if (row === undefined) {
      throw new AppError("NOT_FOUND", "Job not found", 404);
    }
    return {
      id: row.id,
      version: row.version,
      job: row.snapshot as JobSnapshot,
    };
  }
}

type ChatMessageLite = {
  role: "system" | "user" | "assistant";
  content: string;
};

function buildScoringMessages(
  persona: PersonaSnapshot,
  job: JobSnapshot,
): readonly ChatMessageLite[] {
  return [
    {
      role: "system",
      content: [
        "あなたは就活マッチングの評価者です。ペルソナと求人の構造化データを比較し、",
        "skillFit / cultureValueFit / difficultyGap の3軸を0〜100で評価します。",
        "- 各軸には必ず1〜20件の理由と、根拠となるevidence/signal id（evidenceRefs）を付けます。",
        "- difficultyGapは 0=ギャップなし、100=非常に大きいギャップ です。",
        "- refsは入力データに存在するidのみを引用してください。推測でidを作らないこと。",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({ persona, job }),
    },
  ];
}
