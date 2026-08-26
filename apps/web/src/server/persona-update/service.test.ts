import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabase,
  migrateDatabase,
  personaVersions,
  type DatabaseConnection,
} from "@prizgram/db";
import { personaSnapshotSchema, type PersonaSnapshot } from "@prizgram/shared";

import { AppError } from "../api";
import { LlmClientError } from "@/server/llm";
import { MAX_REEVALUATE_JOBS, PersonaUpdateService } from "./service";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../packages/db/drizzle",
);

const userA = { id: "user-a", loginId: "student.one" };
const userB = { id: "user-b", loginId: "student.two" };

function baseSnapshot() {
  return personaSnapshotSchema.parse({
    skills: [],
    strengths: [],
    weaknesses: [],
    values: ["透明性"],
    preferences: { roles: [], industries: [], workStyles: [], locations: [] },
    experiences: [],
    evidence: [
      {
        id: "ev-base",
        sourceType: "user_input" as const,
        summary: "初回ヒアリングの回答",
      },
    ],
    confidence: 0.5,
  });
}

function proposedSnapshot(
  extraEvidence: Array<{
    id: string;
    sourceType: "application_event" | "user_input";
    sourceId: string;
    summary: string;
  }> = [],
): PersonaSnapshot {
  const base = baseSnapshot();
  return {
    ...base,
    strengths: ["データ基盤への興味が明確化"],
    evidence: [
      ...base.evidence.map((evidence) => ({ ...evidence })),
      ...extraEvidence,
    ],
    confidence: 0.8,
  };
}

let temporaryDirectory: string;
let connection: DatabaseConnection;
let service: PersonaUpdateService;

function seedBaseAndApplication(): {
  personaVersionId: string;
  applicationId: string;
} {
  connection.sqlite
    .prepare("insert into users (id) values (?), (?)")
    .run(userA.id, userB.id);
  connection.sqlite
    .prepare("insert into jobs (id, user_id) values ('job-a', ?)")
    .run(userA.id);
  connection.sqlite
    .prepare(
      "insert into applications (id, user_id, job_id, status) values ('app-a', ?, 'job-a', 'interview')",
    )
    .run(userA.id);
  connection.sqlite
    .prepare(
      'insert into persona_versions (id, user_id, version, snapshot, provenance) values (\'persona-base\', ?, 1, ?, \'{"source":"llm","sourceIds":[],"generatedAt":"2026-08-26T00:00:00Z"}\')',
    )
    .run(userA.id, JSON.stringify(baseSnapshot()));
  // Two real stage events for the application.
  connection.sqlite
    .prepare(
      "insert into application_stage_events (id, user_id, application_id, sequence, from_status, to_status, occurred_at) values ('evt-1', ?, 'app-a', 1, 'saved', 'applying', strftime('%s','now')*1000)",
    )
    .run(userA.id);
  connection.sqlite
    .prepare(
      "insert into application_stage_events (id, user_id, application_id, sequence, from_status, to_status, note, occurred_at) values ('evt-2', ?, 'app-a', 2, 'applying', 'submitted', '面接でデータ基盤に興味を示された', strftime('%s','now')*1000)",
    )
    .run(userA.id);
  return { personaVersionId: "persona-base", applicationId: "app-a" };
}

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "prizgram-pu-"));
  connection = createDatabase(path.join(temporaryDirectory, "pu.sqlite"));
  migrateDatabase(connection, migrationsFolder);
  service = new PersonaUpdateService(connection);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("PersonaUpdateService", () => {
  it("approves a proposal whose event evidence cites real stage events", () => {
    const ids = seedBaseAndApplication();
    const snapshot = proposedSnapshot([
      {
        id: "ev-new-event",
        sourceType: "application_event",
        sourceId: "evt-2",
        summary: "面接での評価を反映",
      },
      {
        id: "ev-reflection",
        sourceType: "user_input",
        sourceId: "reflection:abc123",
        summary: "ユーザーの振り返りメモ",
      },
    ]);

    const approved = service.approve(userA, {
      basePersonaVersionId: ids.personaVersionId,
      applicationId: ids.applicationId,
      requestId: "req-update-1",
      snapshot: snapshot,
    });

    expect(approved.version).toBe(2);
    const rows = connection.db.select().from(personaVersions).all();
    expect(rows).toHaveLength(2);
    const newRow = rows.find((row) => row.id === approved.personaVersionId);
    expect(newRow?.provenance.sourceIds).toContain("update-of:persona-base");
  });

  it("rejects approval citing a non-existent stage event without writing", () => {
    const ids = seedBaseAndApplication();
    expect(() =>
      service.approve(userA, {
        basePersonaVersionId: ids.personaVersionId,
        applicationId: ids.applicationId,
        requestId: "req-bad-1",
        snapshot: proposedSnapshot([
          {
            id: "ev-fake",
            sourceType: "application_event",
            sourceId: "evt-999",
            summary: "存在しないイベント",
          },
        ]),
      }),
    ).toThrow(AppError);
    expect(connection.db.select().from(personaVersions).all()).toHaveLength(1);
  });

  it("keeps users isolated on approve", () => {
    const ids = seedBaseAndApplication();
    expect(() =>
      service.approve(userB, {
        basePersonaVersionId: ids.personaVersionId,
        requestId: "req-cross-user",
        snapshot: proposedSnapshot(),
      }),
    ).toThrow(AppError);
  });

  it("returns the stored version when the same requestId is replayed", () => {
    const ids = seedBaseAndApplication();
    const input = {
      basePersonaVersionId: ids.personaVersionId,
      requestId: "req-replay-1",
      snapshot: proposedSnapshot(),
    };

    const first = service.approve(userA, input);
    const second = service.approve(userA, input);

    expect(second.personaVersionId).toBe(first.personaVersionId);
    expect(second.version).toBe(first.version);
    expect(connection.db.select().from(personaVersions).all()).toHaveLength(2);
  });

  it("carries forward intake-derived evidence citing its stored answer id", () => {
    // A persona generated from intake stores the answer-row id (not the
    // evidence id) as its user_input sourceId. A faithful proposal repeats
    // that entry verbatim and must not be rejected (#13).
    const answerId = "answer-row-q1";
    const carriedBase = personaSnapshotSchema.parse({
      ...baseSnapshot(),
      evidence: [
        {
          id: "ev-intake",
          sourceType: "user_input" as const,
          sourceId: answerId,
          summary: "初回ヒアリングの回答",
        },
      ],
    });
    connection.sqlite
      .prepare("insert into users (id) values (?)")
      .run(userA.id);
    connection.sqlite
      .prepare(
        'insert into persona_versions (id, user_id, version, snapshot, provenance) values (\'persona-intake\', ?, 1, ?, \'{"source":"llm","sourceIds":[],"generatedAt":"2026-08-26T00:00:00Z"}\')',
      )
      .run(userA.id, JSON.stringify(carriedBase));

    const approved = service.approve(userA, {
      basePersonaVersionId: "persona-intake",
      requestId: "req-carry-forward",
      snapshot: personaSnapshotSchema.parse({
        ...carriedBase,
        strengths: ["面接で確認できた強み"],
        confidence: 0.7,
      }),
    });

    expect(approved.version).toBe(2);
  });

  it("still rejects user_input evidence citing an invented source", () => {
    seedBaseAndApplication();
    expect(() =>
      service.approve(userA, {
        basePersonaVersionId: "persona-base",
        requestId: "req-invented",
        snapshot: personaSnapshotSchema.parse({
          ...baseSnapshot(),
          evidence: [
            ...baseSnapshot().evidence,
            {
              id: "ev-invented",
              sourceType: "user_input" as const,
              sourceId: "q1_skills",
              summary: "質問IDをそのまま引用した偽装エビデンス",
            },
          ],
        }),
      }),
    ).toThrow(AppError);
    expect(connection.db.select().from(personaVersions).all()).toHaveLength(1);
  });
});

describe("PersonaUpdateService.propose error contract", () => {
  it("maps retryable LLM failures to UPSTREAM_UNAVAILABLE without writing", async () => {
    const ids = seedBaseAndApplication();
    const failingClient = {
      generateStructured: () =>
        Promise.reject(new LlmClientError("TIMEOUT", "timed out", true)),
    };
    await expect(
      service.propose(
        userA,
        {
          personaVersionId: ids.personaVersionId,
          reflection: "面接でデータ基盤への興味を評価された。",
        },
        { client: failingClient },
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", status: 502 });
    expect(connection.db.select().from(personaVersions).all()).toHaveLength(1);
  });

  it("maps non-retryable LLM failures to UPSTREAM_INVALID_RESPONSE", async () => {
    const ids = seedBaseAndApplication();
    const failingClient = {
      generateStructured: () =>
        Promise.reject(
          new LlmClientError("SCHEMA_VALIDATION_FAILED", "bad shape", false),
        ),
    };
    await expect(
      service.propose(
        userA,
        {
          personaVersionId: ids.personaVersionId,
          reflection: "面接でデータ基盤への興味を評価された。",
        },
        { client: failingClient },
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE", status: 502 });
  });
});

describe("PersonaUpdateService.reEvaluateAll", () => {
  function seedJobs(count: number): string[] {
    const jobIds: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const jobId = `job-${index}`;
      connection.sqlite
        .prepare("insert into jobs (id, user_id) values (?, ?)")
        .run(jobId, userA.id);
      jobIds.push(jobId);
    }
    return jobIds;
  }

  function scoringStub() {
    const evaluated: string[] = [];
    return {
      evaluated,
      scoring: {
        evaluate: (userId: string, jobId: string) => {
          evaluated.push(jobId);
          return Promise.resolve({
            detail: { scoreId: `score-${jobId}` },
            duplicate: false,
          });
        },
      },
    };
  }

  /** Persists what one pass produced so the next pass can observe it. */
  function markScored(personaVersionId: string, jobIds: string[]): void {
    for (const jobId of jobIds) {
      connection.sqlite
        .prepare(
          "insert into job_versions (id, user_id, job_id, version, snapshot, content_hash) values (?, ?, ?, 1, '{}', 'hash')",
        )
        .run(`jv-${jobId}`, userA.id, jobId);
      connection.sqlite
        .prepare(
          "insert into match_scores (id, user_id, persona_version_id, job_version_id, skill_fit_score, skill_fit_reasons, skill_fit_evidence_refs, culture_value_fit_score, culture_value_fit_reasons, culture_value_fit_evidence_refs, difficulty_gap_score, difficulty_gap_reasons, difficulty_gap_evidence_refs, model, prompt_version) values (?, ?, ?, ?, 50, '[]', '[]', 50, '[]', '[]', 50, '[]', '[]', 'test-model', 'test-prompt')",
        )
        .run(`score-${jobId}`, userA.id, personaVersionId, `jv-${jobId}`);
    }
  }

  it("caps the per-request fan-out and reports the remaining jobs", async () => {
    seedBaseAndApplication();
    seedJobs(MAX_REEVALUATE_JOBS + 7);
    const { evaluated, scoring } = scoringStub();

    const result = await service.reEvaluateAll(userA, "persona-base", {
      scoring,
    });

    expect(evaluated).toHaveLength(MAX_REEVALUATE_JOBS);
    expect(result.audit).toHaveLength(MAX_REEVALUATE_JOBS);
    // job-a from seedBaseAndApplication plus the seeded rows.
    expect(result.remainingJobs).toBe(8);
    // Oldest jobs first so repeated passes make deterministic progress.
    expect(result.audit[0]?.jobId).toBe("job-0");
  });

  it("honors an explicit smaller limit", async () => {
    seedBaseAndApplication();
    seedJobs(5);
    const { evaluated, scoring } = scoringStub();

    const result = await service.reEvaluateAll(userA, "persona-base", {
      scoring,
      limit: 2,
    });

    expect(evaluated).toHaveLength(2);
    expect(result.remainingJobs).toBe(4);
  });

  it("skips jobs already scored for the persona so repeated passes converge", async () => {
    seedBaseAndApplication();
    seedJobs(MAX_REEVALUATE_JOBS + 7);
    const { evaluated, scoring } = scoringStub();

    const first = await service.reEvaluateAll(userA, "persona-base", {
      scoring,
    });
    expect(first.remainingJobs).toBe(8);
    const firstBatch = new Set(evaluated);
    markScored("persona-base", [...evaluated]);

    const second = await service.reEvaluateAll(userA, "persona-base", {
      scoring,
    });

    expect(second.audit).toHaveLength(first.remainingJobs);
    for (const entry of second.audit) {
      expect(firstBatch.has(entry.jobId)).toBe(false);
    }
    expect(second.remainingJobs).toBe(0);
  });
});
