import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  personaSnapshotSchema,
  type AuthenticatedUser,
  type PersonaSnapshot,
} from "@prizgram/shared";
import { applicationStageEvents, personaVersions, jobs } from "@prizgram/db";

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

export interface EventEvidenceSource {
  eventId: string;
  sequence: number;
  toStatus: string;
  occurredAt: string;
}

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
    baseEvidenceIds: ReadonlySet<string>,
    eventSources: readonly EventEvidenceSource[],
    snapshot: PersonaSnapshot,
  ): PersonaSnapshot {
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
    const baseEvidence = new Set(base.snapshot.evidence.map((e) => e.id));
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

    const maxVersion = this.connection.sqlite
      .prepare(
        "select max(version) as value from persona_versions where user_id = ?",
      )
      .get(user.id) as { value: number | null };
    const version = Number(maxVersion.value ?? 0) + 1;
    const personaVersionId = randomUUID();
    this.connection.db
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
    const baseEvidence = new Set(baseSnapshot.evidence.map((e) => e.id));
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

    // The provider schema above is the persona one; reuse its normalization
    // by parsing through the structured contract for parity.
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
      baseEvidence,
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
   * Re-evaluates every owned job's latest version against a persona version.
   * Per-job failures are captured in the returned audit trail; one failure
   * does not stop the rest.
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
    },
  ): Promise<
    Array<
      | { jobId: string; status: "scored"; scoreId: string }
      | { jobId: string; status: "failed"; code: string }
    >
  > {
    this.baseVersion(user, personaVersionId);
    const jobRows = this.connection.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.userId, user.id))
      .all();

    const audit: Array<
      | { jobId: string; status: "scored"; scoreId: string }
      | { jobId: string; status: "failed"; code: string }
    > = [];
    for (const job of jobRows) {
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
    return audit;
  }
}
