import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  personaSnapshotSchema,
  type AuthenticatedUser,
  type PersonaSnapshot,
} from "@prizgram/shared";
import {
  applicationStageEvents,
  jobVersions,
  jobs,
  matchScores,
  personaVersions,
} from "@prizgram/db";

import type { DatabaseConnection } from "@prizgram/db";
import { AppError } from "../api";
import {
  createLlmClientFromEnvironment,
  LlmClientError,
  personaStructuredOutput,
  type StructuredLlmClient,
} from "@/server/llm";

export const proposeRequestSchema = z
  .object({
    /** Base persona version; defaults to the user's latest. */
    personaVersionId: z.string().trim().min(1).max(128).optional(),
    /** Selection events of this application become evidence candidates. */
    applicationId: z.string().trim().min(1).max(128).optional(),
    /** Free-form reflection written by the user. */
    reflection: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const approveRequestSchema = z
  .object({
    basePersonaVersionId: z.string().trim().min(1).max(128),
    snapshot: personaSnapshotSchema,
    applicationId: z.string().trim().min(1).max(128).optional(),
    requestId: z.string().trim().min(8).max(128),
  })
  .strict();

export type ProposeInput = z.infer<typeof proposeRequestSchema>;
export type ApproveInput = z.infer<typeof approveRequestSchema>;

const REFLECTION_PREFIX = "reflection:";
const EVENT_PREFIX = "event:";

const VERSION_UNIQUE_VIOLATION =
  /unique constraint failed: .*persona_versions.*user_id.*version|persona_versions_user_version_unique/i;

/** Matches only the persona_versions (user_id, version) unique violation. */
export function isPersonaVersionUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    typeof code === "string" &&
    code.startsWith("SQLITE_CONSTRAINT") &&
    typeof message === "string" &&
    VERSION_UNIQUE_VIOLATION.test(message)
  );
}

export interface EventEvidenceSource {
  eventId: string;
  sequence: number;
  toStatus: string;
  occurredAt: string;
}

/**
 * Upper bound on jobs re-evaluated per request. Every processed job may
 * trigger one LLM call (a fresh persona version never reuses stored
 * scores), so the fan-out must stay bounded; callers continue by invoking
 * the endpoint again while `remainingJobs > 0`.
 */
export const MAX_REEVALUATE_JOBS = 20;

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
      "The persona update could not be proposed right now",
      502,
      undefined,
      undefined,
      { cause: error },
    );
  }
  throw error;
}

export class PersonaUpdateService {
  constructor(private readonly connection: DatabaseConnection) {}

  baseVersion(user: AuthenticatedUser, versionId?: string) {
    const row =
      versionId === undefined
        ? this.connection.db
            .select()
            .from(personaVersions)
            .where(eq(personaVersions.userId, user.id))
            .all()
            .sort((a, b) => b.version - a.version)[0]
        : this.connection.db
            .select()
            .from(personaVersions)
            .where(
              and(
                eq(personaVersions.id, versionId),
                eq(personaVersions.userId, user.id),
              ),
            )
            .get();
    if (row === undefined) {
      throw new AppError("NOT_FOUND", "Persona not found", 404);
    }
    return row;
  }

  /**
   * Loads the selection-event digest for an owned application. Event ids are
   * the only allowed application_event sourceIds in a proposal.
   */
  loadEventSources(
    userId: string,
    applicationId: string,
  ): EventEvidenceSource[] {
    const owned = this.connection.sqlite
      .prepare("select id from applications where id = ? and user_id = ?")
      .get(applicationId, userId);
    if (owned === undefined) {
      throw new AppError("NOT_FOUND", "Application not found", 404);
    }
    const rows = this.connection.db
      .select()
      .from(applicationStageEvents)
      .where(eq(applicationStageEvents.applicationId, applicationId))
      .all();
    rows.sort((a, b) => a.sequence - b.sequence);
    return rows.map((row) => ({
      eventId: row.id,
      sequence: row.sequence,
      toStatus: row.toStatus,
      occurredAt: row.occurredAt.toISOString(),
    }));
  }

  /**
   * Context-dependent validation shared by propose (server-generated) and
   * approve (client-echoed): every evidence entry must cite an allowed
   * source — base evidence ids, real stage-event ids, or a reflection.
   */
  validateEvidence(
    userId: string,
    baseEvidence: PersonaSnapshot["evidence"],
    eventSources: readonly EventEvidenceSource[],
    snapshot: PersonaSnapshot,
  ): PersonaSnapshot {
    const baseEvidenceIds = new Set(baseEvidence.map((e) => e.id));
    // Intake-generated personas carry answer-row ids as user_input
    // sourceIds, so carrying an existing entry forward must keep citing it.
    const baseUserInputSourceIds = new Set(
      baseEvidence
        .filter((e) => e.sourceType === "user_input")
        .map((e) => e.sourceId)
        .filter((sourceId): sourceId is string => sourceId !== undefined),
    );
    const eventIds = new Set(eventSources.map((e) => e.eventId));
    for (const evidence of snapshot.evidence) {
      switch (evidence.sourceType) {
        case "application_event": {
          if (
            evidence.sourceId === undefined ||
            !eventIds.has(evidence.sourceId)
          ) {
            throw new AppError(
              "UPSTREAM_INVALID_RESPONSE",
              "application_event evidence must cite a real selection event",
              502,
            );
          }
          break;
        }
        case "user_input": {
          if (
            evidence.sourceId !== undefined &&
            !baseEvidenceIds.has(evidence.sourceId) &&
            !baseUserInputSourceIds.has(evidence.sourceId) &&
            !evidence.sourceId.startsWith(REFLECTION_PREFIX) &&
            !eventIds.has(evidence.sourceId)
          ) {
            throw new AppError(
              "UPSTREAM_INVALID_RESPONSE",
              `Unknown evidence source: ${evidence.sourceId}`,
              502,
            );
          }
          break;
        }
        default: {
          // llm/system sources must derive from the base persona only.
          if (
            evidence.sourceId === undefined ||
            !baseEvidenceIds.has(evidence.sourceId)
          ) {
            throw new AppError(
              "UPSTREAM_INVALID_RESPONSE",
              "Inferred evidence must cite base persona evidence",
              502,
            );
          }
        }
      }
    }
    void userId;
    return snapshot;
  }

  /** Inserts an approved snapshot as the next immutable persona version. */
  approve(
    user: AuthenticatedUser,
    input: ApproveInput,
  ): { personaVersionId: string; version: number } {
    const base = this.baseVersion(user, input.basePersonaVersionId);

    // Idempotency: a retried approval (e.g. the response was lost after the
    // insert committed) must return the stored version instead of minting
    // another one for the same requestId.
    const replayed = this.findVersionByRequestId(user.id, input.requestId);
    if (replayed !== undefined) return replayed;

    const baseEvidence = base.snapshot.evidence;
    const eventSources =
      input.applicationId === undefined
        ? []
        : this.loadEventSources(user.id, input.applicationId);

    // Re-validate the client-echoed snapshot at approval time.
    const validated = this.validateEvidence(
      user.id,
      baseEvidence,
      eventSources,
      input.snapshot,
    );

    let lastError: unknown;
    // Version numbers are computed and inserted inside one transaction, and
    // a unique (user_id, version) violation from another writer is retried
    // once with a fresh number — mirroring generatePersona.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return this.connection.db.transaction((transaction) => {
          const maxVersion = transaction
            .select({
              value: sql<number>`coalesce(max(${personaVersions.version}), 0)`,
            })
            .from(personaVersions)
            .where(eq(personaVersions.userId, user.id))
            .get();
          const version = Number(maxVersion?.value ?? 0) + 1;
          const personaVersionId = randomUUID();
          transaction
            .insert(personaVersions)
            .values({
              id: personaVersionId,
              userId: user.id,
              version,
              snapshot: validated,
              provenance: {
                source: "llm",
                sourceIds: [
                  `update-of:${base.id}`,
                  ...eventSources.map((e) => `${EVENT_PREFIX}${e.eventId}`),
                  `${REFLECTION_PREFIX}${input.requestId}`,
                ],
                generatedAt: new Date().toISOString(),
                model: "human-approved",
                promptVersion: "feedback-v1",
              },
            })
            .run();
          return { personaVersionId, version };
        });
      } catch (error) {
        lastError = error;
        if (!isPersonaVersionUniqueViolation(error)) throw error;
      }
    }
    throw lastError;
  }

  /**
   * Finds an already-approved persona version carrying this exact request
   * id in its provenance, so duplicate submissions are absorbed.
   */
  private findVersionByRequestId(
    userId: string,
    requestId: string,
  ): { personaVersionId: string; version: number } | undefined {
    const rows = this.connection.db
      .select({ id: personaVersions.id, version: personaVersions.version })
      .from(personaVersions)
      .where(eq(personaVersions.userId, userId))
      .all();
    const marker = `${REFLECTION_PREFIX}${requestId}`;
    for (const row of rows) {
      const raw = this.connection.sqlite
        .prepare("select provenance from persona_versions where id = ?")
        .get(row.id) as { provenance: string } | undefined;
      if (raw === undefined) continue;
      try {
        const provenance = JSON.parse(raw.provenance) as {
          sourceIds?: unknown;
        };
        if (
          Array.isArray(provenance.sourceIds) &&
          provenance.sourceIds.includes(marker)
        ) {
          return { personaVersionId: row.id, version: row.version };
        }
      } catch {
        // Undecodable provenance cannot match any requestId.
      }
    }
    return undefined;
  }

  /** Builds the prompt digest of selection events for proposals. */
  static buildEventDigest(events: readonly EventEvidenceSource[]): string {
    if (events.length === 0) return "（選考イベントはありません）";
    return events
      .map(
        (event) =>
          `- [id=${event.eventId}] ${event.toStatus} (${event.occurredAt})`,
      )
      .join("\n");
  }

  /**
   * LLM proposal: produces a FULL candidate snapshot from the base persona,
   * selection events, and the user's reflection. Validated with the same
   * evidence rules as approval; the caller decides whether to approve.
   */
  async propose(
    user: AuthenticatedUser,
    input: ProposeInput,
    options: { client?: StructuredLlmClient; model?: string } = {},
  ): Promise<{
    basePersonaVersionId: string;
    proposed: PersonaSnapshot;
    eventSources: EventEvidenceSource[];
  }> {
    const client = options.client ?? defaultClient();

    const base = this.baseVersion(user, input.personaVersionId);
    const baseSnapshot = base.snapshot;
    const eventSources =
      input.applicationId === undefined
        ? []
        : this.loadEventSources(user.id, input.applicationId);

    const messages = [
      {
        role: "system" as const,
        content: [
          "あなたは就活ペルソナの更新案を作成します。",
          "入力: 現在のペルソナJSON、選考イベント一覧、ユーザーの振り返り。",
          "選考結果だけで能力や性格を断定せず、回答・イベント・振り返りに書かれた事実のみで更新してください。",
          "出力は現在と同じスキーマの完全なペルソナJSONです。",
          "新しく追加するevidenceは:",
          ` - 選考イベント由来なら sourceType "application_event" で、提示された event id を sourceId に`,
          ` - 振り返り由来なら sourceType "user_input" で sourceId を "${REFLECTION_PREFIX}..." 形式に`,
          "既存の事実を消さないでください。confidenceも見直してください。",
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: JSON.stringify({
          currentPersona: baseSnapshot,
          selectionEvents: PersonaUpdateService.buildEventDigest(eventSources),
          reflection: input.reflection,
        }),
      },
    ];

    let raw: PersonaSnapshot;
    try {
      raw = await client.generateStructured({
        messages,
        output: personaStructuredOutput,
        schemaName: "persona_update_proposal",
      });
    } catch (error) {
      // LLM failures surface as the same 502 contract as the other
      // LLM-backed services instead of an opaque 500.
      throw upstreamError(error);
    }

    const eventIds = new Set(eventSources.map((e) => e.eventId));
    const validated = this.validateEvidence(
      user.id,
      baseSnapshot.evidence,
      eventSources,
      raw,
    );
    // Ensure llm_inference-free proposals keep only allowed sources.
    for (const evidence of validated.evidence) {
      if (
        evidence.sourceType === "application_event" &&
        evidence.sourceId !== undefined &&
        !eventIds.has(evidence.sourceId)
      ) {
        throw new AppError(
          "UPSTREAM_INVALID_RESPONSE",
          "proposal cites an unknown selection event",
          502,
        );
      }
    }

    return {
      basePersonaVersionId: base.id,
      proposed: validated,
      eventSources,
    };
  }

  /**
   * Re-evaluates the user's jobs against a persona version, oldest job
   * first, bounded by `limit` (capped at MAX_REEVALUATE_JOBS). Jobs already
   * scored for this persona version are skipped so repeated passes make
   * forward progress instead of re-processing the same oldest batch.
   * Per-job failures are captured in the audit trail; one failure does not
   * stop the rest. `remainingJobs` tells the caller how many unscored jobs
   * were not processed in this pass.
   */
  async reEvaluateAll(
    user: AuthenticatedUser,
    personaVersionId: string,
    options: {
      scoring: {
        evaluate: (
          userId: string,
          jobId: string,
          evalOptions?: { personaVersionId?: string },
        ) => Promise<{
          detail: { scoreId: string };
          duplicate: boolean;
        }>;
      };
      limit?: number;
    },
  ): Promise<{
    audit: Array<
      | { jobId: string; status: "scored"; scoreId: string }
      | { jobId: string; status: "failed"; code: string }
    >;
    remainingJobs: number;
  }> {
    this.baseVersion(user, personaVersionId);
    const effectiveLimit = Math.max(
      0,
      Math.min(options.limit ?? MAX_REEVALUATE_JOBS, MAX_REEVALUATE_JOBS),
    );
    const totalJobs = this.connection.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.userId, user.id))
      .orderBy(asc(jobs.createdAt), asc(jobs.id))
      .all();

    // A job counts as done for this pass once any score pins it to this
    // persona version; scoring itself dedupes per (persona, job version),
    // so re-selecting it would only stall the batch window.
    const scoredJobIds = new Set(
      this.connection.db
        .select({ jobId: jobVersions.jobId })
        .from(matchScores)
        .innerJoin(jobVersions, eq(jobVersions.id, matchScores.jobVersionId))
        .where(
          and(
            eq(matchScores.userId, user.id),
            eq(matchScores.personaVersionId, personaVersionId),
          ),
        )
        .all()
        .map((row) => row.jobId),
    );
    const pendingJobs = totalJobs.filter((job) => !scoredJobIds.has(job.id));

    const targets = pendingJobs.slice(0, effectiveLimit);
    const audit: Array<
      | { jobId: string; status: "scored"; scoreId: string }
      | { jobId: string; status: "failed"; code: string }
    > = [];
    for (const job of targets) {
      try {
        const result = await options.scoring.evaluate(user.id, job.id, {
          personaVersionId,
        });
        audit.push({
          jobId: job.id,
          status: "scored",
          scoreId: result.detail.scoreId,
        });
      } catch (error) {
        audit.push({
          jobId: job.id,
          status: "failed",
          code:
            error instanceof Error && "code" in error
              ? String((error as { code: unknown }).code)
              : "UNKNOWN",
        });
      }
    }
    return {
      audit,
      remainingJobs: Math.max(0, pendingJobs.length - targets.length),
    };
  }
}
