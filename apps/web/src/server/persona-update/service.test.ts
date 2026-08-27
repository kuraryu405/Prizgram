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
import { LlmClientError, type StructuredLlmClient } from "@/server/llm";
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

  it("rejects user_input evidence that misclassifies an application event id", () => {
    // #201: event id must be cited as application_event, not user_input
    const ids = seedBaseAndApplication();
    expect(() =>
      service.approve(userA, {
        basePersonaVersionId: ids.personaVersionId,
        applicationId: ids.applicationId,
        requestId: "req-misclassify-event",
        snapshot: personaSnapshotSchema.parse({
          ...baseSnapshot(),
          evidence: [
            ...baseSnapshot().evidence,
            {
              id: "ev-misclass",
              sourceType: "user_input" as const,
              sourceId: "evt-1",
              summary: "イベントIDを誤ってuser_inputで引用",
            },
          ],
        }),
      }),
    ).toThrow(AppError);
    expect(connection.db.select().from(personaVersions).all()).toHaveLength(1);
  });

  it("rejects proposal that drops base evidence", () => {
    const ids = seedBaseAndApplication();
    // Base has ev-base; propose without it should be rejected
    const dropped = personaSnapshotSchema.parse({
      ...baseSnapshot(),
      evidence: [], // drop ev-base
    });
    expect(() =>
      service.approve(userA, {
        basePersonaVersionId: ids.personaVersionId,
        requestId: "req-drop-evidence",
        snapshot: dropped,
      }),
    ).toThrow(AppError);
    expect(connection.db.select().from(personaVersions).all()).toHaveLength(1);
  });

  it("loads event sources with note and fromStatus and builds digest with them", () => {
    const ids = seedBaseAndApplication();
    const sources = service.loadEventSources(userA.id, ids.applicationId);
    expect(sources).toHaveLength(2);
    // evt-1 has fromStatus saved, null note
    expect(sources[0]).toMatchObject({
      eventId: "evt-1",
      fromStatus: "saved",
      toStatus: "applying",
      note: null,
    });
    // evt-2 has note
    expect(sources[1]).toMatchObject({
      eventId: "evt-2",
      fromStatus: "applying",
      toStatus: "submitted",
      note: "面接でデータ基盤に興味を示された",
    });
    const digest = PersonaUpdateService.buildEventDigest(sources);
    // Should contain from -> to and note JSON
    expect(digest).toContain("saved -> applying");
    expect(digest).toContain("applying -> submitted");
    expect(digest).toContain(
      JSON.stringify("面接でデータ基盤に興味を示された"),
    );
    // No note for evt-1 should not contain note:
    const lines = digest.split("\n");
    expect(lines[0]).not.toContain("note:");
    expect(lines[1]).toContain("note:");
  });

  it("builds digest without note when note is empty or whitespace", () => {
    const digest = PersonaUpdateService.buildEventDigest([
      {
        eventId: "evt-x",
        sequence: 1,
        fromStatus: null,
        toStatus: "interview",
        note: "   ",
        occurredAt: new Date().toISOString(),
      },
    ]);
    expect(digest).not.toContain("note:");
    expect(digest).toContain("interview");
  });

  it("rejects proposal that drops base skill", () => {
    // Seed a base with a skill
    const skillBase = personaSnapshotSchema.parse({
      ...baseSnapshot(),
      skills: [
        {
          name: "TypeScript",
          level: "intermediate",
          evidenceRefs: ["ev-base"],
        },
      ],
    });
    connection.sqlite
      .prepare("insert into users (id) values (?)")
      .run(userA.id);
    connection.sqlite
      .prepare(
        'insert into persona_versions (id, user_id, version, snapshot, provenance) values (\'persona-skill\', ?, 1, ?, \'{"source":"llm","sourceIds":[],"generatedAt":"2026-08-26T00:00:00Z"}\')',
      )
      .run(userA.id, JSON.stringify(skillBase));

    const droppedSkill = personaSnapshotSchema.parse({
      ...skillBase,
      skills: [], // drop TypeScript
    });
    expect(() =>
      service.approve(userA, {
        basePersonaVersionId: "persona-skill",
        requestId: "req-drop-skill",
        snapshot: droppedSkill,
      }),
    ).toThrow(AppError);
  });

  it("rejects proposal that drops base experience", () => {
    const expBase = personaSnapshotSchema.parse({
      ...baseSnapshot(),
      experiences: [
        {
          title: "Webアプリ開発",
          description: "チームで開発した。",
          evidenceRefs: ["ev-base"],
        },
      ],
    });
    connection.sqlite
      .prepare("insert into users (id) values (?)")
      .run(userA.id);
    connection.sqlite
      .prepare(
        'insert into persona_versions (id, user_id, version, snapshot, provenance) values (\'persona-exp\', ?, 1, ?, \'{"source":"llm","sourceIds":[],"generatedAt":"2026-08-26T00:00:00Z"}\')',
      )
      .run(userA.id, JSON.stringify(expBase));

    const droppedExp = personaSnapshotSchema.parse({
      ...expBase,
      experiences: [], // drop
    });
    expect(() =>
      service.approve(userA, {
        basePersonaVersionId: "persona-exp",
        requestId: "req-drop-exp",
        snapshot: droppedExp,
      }),
    ).toThrow(AppError);
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

  it("rejects propose that drops base facts via carry-forward invariant", async () => {
    const ids = seedBaseAndApplication();
    const droppedClient = {
      generateStructured: () =>
        Promise.resolve(
          personaSnapshotSchema.parse({
            ...baseSnapshot(),
            evidence: [], // drop base evidence
          }),
        ),
    } as unknown as StructuredLlmClient;
    await expect(
      service.propose(
        userA,
        {
          personaVersionId: ids.personaVersionId,
          reflection: "振り返りメモ",
        },
        { client: droppedClient },
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE", status: 502 });
    expect(connection.db.select().from(personaVersions).all()).toHaveLength(1);
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
      // Ensure each job has a latest version for freshness checks (#160)
      connection.sqlite
        .prepare(
          "insert into job_versions (id, user_id, job_id, version, snapshot, content_hash) values (?, ?, ?, 1, '{}', 'hash')",
        )
        .run(`jv-${jobId}-v1`, userA.id, jobId);
      jobIds.push(jobId);
    }
    // Ensure job-a from seedBase also has a version
    const hasJobAVersion = connection.sqlite
      .prepare("select 1 from job_versions where id = 'jv-job-a-v1' limit 1")
      .get();
    if (hasJobAVersion === undefined) {
      // job-a was created without version in seedBase; add one now if missing
      try {
        connection.sqlite
          .prepare(
            "insert into job_versions (id, user_id, job_id, version, snapshot, content_hash) values ('jv-job-a-v1', ?, 'job-a', 1, '{}', 'hash')",
          )
          .run(userA.id);
      } catch {
        void 0;
      }
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
    const currentModel = process.env.OPENAI_MODEL ?? "unknown-model";
    for (const jobId of jobIds) {
      // Ensure latest version id exists for this job
      let versionId = `jv-${jobId}-v1`;
      // For job-a, the version id is jv-job-a-v1
      if (jobId === "job-a") versionId = "jv-job-a-v1";
      const exists = connection.sqlite
        .prepare("select 1 from job_versions where id = ? limit 1")
        .get(versionId);
      if (exists === undefined) {
        connection.sqlite
          .prepare(
            "insert into job_versions (id, user_id, job_id, version, snapshot, content_hash) values (?, ?, ?, 1, '{}', 'hash')",
          )
          .run(versionId, userA.id, jobId);
      }
      connection.sqlite
        .prepare(
          "insert into match_scores (id, user_id, persona_version_id, job_version_id, skill_fit_score, skill_fit_reasons, skill_fit_evidence_refs, culture_value_fit_score, culture_value_fit_reasons, culture_value_fit_evidence_refs, difficulty_gap_score, difficulty_gap_reasons, difficulty_gap_evidence_refs, model, prompt_version) values (?, ?, ?, ?, 50, '[]', '[]', 50, '[]', '[]', 50, '[]', '[]', ?, 'scoring-v1')",
        )
        .run(
          `score-${jobId}`,
          userA.id,
          personaVersionId,
          versionId,
          currentModel,
        );
    }
  }

  it("caps the per-request fan-out and reports the remaining jobs", async () => {
    seedBaseAndApplication();
    // With MAX=5, seed 7 ensures total = 1(job-a)+7=8, first batch 5 => remaining 3
    const extra = 7;
    seedJobs(extra);
    const { evaluated, scoring } = scoringStub();

    const result = await service.reEvaluateAll(userA, "persona-base", {
      scoring,
      enforceBudget: () => {},
    });

    expect(evaluated).toHaveLength(Math.min(MAX_REEVALUATE_JOBS, 1 + extra));
    expect(result.audit).toHaveLength(Math.min(MAX_REEVALUATE_JOBS, 1 + extra));
    // job-a from seedBaseAndApplication plus the seeded rows = 8, minus 5 = 3
    expect(result.remainingJobs).toBe(3);
    // Oldest jobs first so repeated passes make deterministic progress.
    expect(result.audit[0]?.jobId).toBe("job-0");
  });

  it("honors an explicit smaller limit", async () => {
    seedBaseAndApplication();
    seedJobs(5);
    const { evaluated, scoring } = scoringStub();

    const result = await service.reEvaluateAll(userA, "persona-base", {
      scoring,
      enforceBudget: () => {},
      limit: 2,
    });

    expect(evaluated).toHaveLength(2);
    // total 1+5=6, limit 2 => remaining 4
    expect(result.remainingJobs).toBe(4);
  });

  it("skips jobs already scored for the persona so repeated passes converge", async () => {
    seedBaseAndApplication();
    seedJobs(7); // 1(job-a) +7 =8 total
    const { evaluated, scoring } = scoringStub();

    const first = await service.reEvaluateAll(userA, "persona-base", {
      scoring,
      enforceBudget: () => {},
    });
    // MAX=5, first batch 5, remaining 3
    expect(first.audit).toHaveLength(5);
    expect(first.remainingJobs).toBe(3);
    const firstBatch = new Set(evaluated);
    markScored("persona-base", [...evaluated]);

    const second = await service.reEvaluateAll(userA, "persona-base", {
      scoring,
      enforceBudget: () => {},
    });
    expect(second.audit).toHaveLength(3);
    for (const entry of second.audit) {
      expect(firstBatch.has(entry.jobId)).toBe(false);
    }
    expect(second.remainingJobs).toBe(0);
  });

  it("treats failed jobs as remaining (#165)", async () => {
    seedBaseAndApplication();
    seedJobs(3); // 1+3=4 total
    let call = 0;
    const scoring = {
      evaluate: () => {
        call += 1;
        if (call <= 2)
          return Promise.reject(
            Object.assign(new Error("LLM down"), {
              code: "UPSTREAM_UNAVAILABLE",
            }),
          );
        return Promise.resolve({
          detail: { scoreId: `score-${call}` },
          duplicate: false,
        });
      },
    };
    const result = await service.reEvaluateAll(userA, "persona-base", {
      scoring,
      enforceBudget: () => {},
    });
    // MAX=5, 4 pending, 2 failed + 2 scored in first pass? Actually we have 4 jobs, all attempted in one batch (limit 5)
    // 2 failed, 2 succeeded => remaining should be 2 (the failed)
    expect(result.audit.filter((e) => e.status === "failed")).toHaveLength(2);
    expect(result.audit.filter((e) => e.status === "scored")).toHaveLength(2);
    expect(result.remainingJobs).toBe(2);
  });

  it("re-queues job when a new jobVersion appears (#160)", async () => {
    seedBaseAndApplication();
    // Create a single job with v1
    connection.sqlite
      .prepare("insert into jobs (id, user_id) values ('job-requeue', ?)")
      .run(userA.id);
    connection.sqlite
      .prepare(
        "insert into job_versions (id, user_id, job_id, version, snapshot, content_hash) values ('jv-requeue-v1', ?, 'job-requeue', 1, '{}', 'hash1')",
      )
      .run(userA.id);
    // Also ensure job-a has version
    seedJobs(0); // ensures job-a version (helper)
    const scoring = {
      evaluate: () =>
        Promise.resolve({
          detail: { scoreId: "score-requeue" },
          duplicate: false,
        }),
    };
    // First pass scores v1
    await service.reEvaluateAll(userA, "persona-base", {
      scoring,
      enforceBudget: () => {},
    });
    // Mark v1 as scored
    connection.sqlite
      .prepare(
        "insert into match_scores (id, user_id, persona_version_id, job_version_id, skill_fit_score, skill_fit_reasons, skill_fit_evidence_refs, culture_value_fit_score, culture_value_fit_reasons, culture_value_fit_evidence_refs, difficulty_gap_score, difficulty_gap_reasons, difficulty_gap_evidence_refs, model, prompt_version) values ('score-requeue-v1', ?, 'persona-base', 'jv-requeue-v1', 50, '[]', '[]', 50, '[]', '[]', 50, '[]', '[]', ?, 'scoring-v1')",
      )
      .run(userA.id, process.env.OPENAI_MODEL ?? "unknown-model");
    // Now add v2 for same job
    connection.sqlite
      .prepare(
        "insert into job_versions (id, user_id, job_id, version, snapshot, content_hash) values ('jv-requeue-v2', ?, 'job-requeue', 2, '{}', 'hash2')",
      )
      .run(userA.id);
    const second = await service.reEvaluateAll(userA, "persona-base", {
      scoring,
      enforceBudget: () => {},
    });
    // Should be pending again because latest is v2 without fresh score
    expect(second.audit.some((e) => e.jobId === "job-requeue")).toBe(true);
    expect(second.remainingJobs).toBeGreaterThanOrEqual(0);
  });

  it("enforces per-call LLM budget (#193)", async () => {
    seedBaseAndApplication();
    seedJobs(3); // 1+3=4
    const scoring = {
      evaluate: () =>
        Promise.resolve({ detail: { scoreId: "score-x" }, duplicate: false }),
    };
    let budgetCalls = 0;
    const enforceBudget = () => {
      budgetCalls += 1;
      if (budgetCalls > 2)
        throw Object.assign(new Error("too many"), {
          code: "RATE_LIMITED",
          status: 429,
        });
    };
    const result = await service.reEvaluateAll(userA, "persona-base", {
      scoring,
      enforceBudget,
    });
    // Should have attempted 2 successes then 1 rate-limited failure, leaving 1+? remaining
    // With 4 pending, 2 successes, 1 rate-limited => remaining = 4-2=2
    expect(result.audit.filter((e) => e.status === "scored")).toHaveLength(2);
    expect(
      result.audit.some(
        (e) =>
          e.status === "failed" &&
          (e as { code: string }).code === "RATE_LIMITED",
      ),
    ).toBe(true);
    expect(result.remainingJobs).toBe(2);
  });

  it("caps batch to MAX_REEVALUATE_JOBS=5 (#194)", () => {
    expect(MAX_REEVALUATE_JOBS).toBe(5);
  });
});

describe("PersonaUpdateService.approve stale check (#186)", () => {
  it("rejects stale base approval with 409", () => {
    const ids = seedBaseAndApplication();
    const firstSnapshot = proposedSnapshot();
    const secondSnapshot = proposedSnapshot([
      {
        id: "ev-extra",
        sourceType: "user_input",
        sourceId: "reflection:second",
        summary: "second",
      },
    ]);
    // First approval from v1 -> v2
    const first = service.approve(userA, {
      basePersonaVersionId: ids.personaVersionId,
      requestId: "req-first",
      snapshot: firstSnapshot,
    });
    expect(first.version).toBe(2);
    // Second approval still using old base v1 should be rejected
    expect(() =>
      service.approve(userA, {
        basePersonaVersionId: ids.personaVersionId,
        requestId: "req-second",
        snapshot: secondSnapshot,
      }),
    ).toThrow(expect.objectContaining({ code: "CONFLICT", status: 409 }));
    expect(connection.db.select().from(personaVersions).all()).toHaveLength(2);
  });

  it("allows idempotent retry with same requestId even if base is now stale", () => {
    const ids = seedBaseAndApplication();
    const snapshot = proposedSnapshot();
    const first = service.approve(userA, {
      basePersonaVersionId: ids.personaVersionId,
      requestId: "req-idempotent",
      snapshot,
    });
    expect(first.version).toBe(2);
    // Create another version via different request to make base stale, but retry same requestId should return existing
    const other = service.approve(userA, {
      basePersonaVersionId: first.personaVersionId,
      requestId: "req-other",
      snapshot: proposedSnapshot(),
    });
    expect(other.version).toBe(3);
    // Retry first requestId – should return original v2 even though base is stale relative to latest v3
    const replay = service.approve(userA, {
      basePersonaVersionId: ids.personaVersionId,
      requestId: "req-idempotent",
      snapshot,
    });
    expect(replay.personaVersionId).toBe(first.personaVersionId);
    expect(replay.version).toBe(2);
  });
});
