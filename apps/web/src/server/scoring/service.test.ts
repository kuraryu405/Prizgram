import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from "@prizgram/db";
import { jobSnapshotSchema, personaSnapshotSchema } from "@prizgram/shared";

import { AppError } from "../api";
import { OpenAiCompatibleClient } from "../llm";
import { ScoringService } from "./service";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../packages/db/drizzle",
);

const userA = { id: "user-a", loginId: "student.one" };
const userB = { id: "user-b", loginId: "student.two" };

function seedPersonaAndJob(): {
  personaVersionId: string;
  jobVersionId: string;
} {
  connection.sqlite
    .prepare("insert into users (id) values (?), (?)")
    .run(userA.id, userB.id);
  const personaSnapshot = personaSnapshotSchema.parse({
    skills: [
      {
        name: "TypeScript",
        level: "intermediate",
        evidenceRefs: ["ev-skills"],
      },
    ],
    strengths: ["分解力"],
    weaknesses: ["発表"],
    values: ["透明性"],
    preferences: {
      roles: ["FE"],
      industries: [],
      workStyles: [],
      locations: [],
    },
    experiences: [],
    evidence: [
      {
        id: "ev-skills",
        sourceType: "user_input" as const,
        summary: "TS経験2年",
      },
    ],
    confidence: 0.7,
  });
  const provenance = JSON.stringify({
    source: "llm",
    sourceIds: [],
    generatedAt: "2026-08-26T00:00:00Z",
  });
  connection.sqlite
    .prepare(
      "insert into persona_versions (id, user_id, version, snapshot, provenance) values ('persona-a', ?, 1, ?, ?)",
    )
    .run(userA.id, JSON.stringify(personaSnapshot), provenance);

  const jobSnapshot = jobSnapshotSchema.parse({
    company: "株式会社サンプル",
    role: "フロントエンド",
    employmentType: "internship",
    description: "説明",
    requirements: [{ id: "job:req:1", text: "TypeScript3年" }],
    desiredSkills: [{ id: "job:skill:1", text: "Next.js" }],
    cultureValues: [{ id: "job:value:1", text: "自律性" }],
    difficulty: { level: "competitive", evidenceRefs: ["job:req:1"] },
    source: {
      kind: "user_provided" as const,
      name: "出典",
      retrievedAt: "2026-08-26T00:00:00Z",
    },
  });
  connection.sqlite
    .prepare("insert into jobs (id, user_id) values ('job-a', ?)")
    .run(userA.id);
  connection.sqlite
    .prepare(
      "insert into job_versions (id, user_id, job_id, version, snapshot, content_hash) values ('jv-a', ?, 'job-a', 1, ?, 'h')",
    )
    .run(userA.id, JSON.stringify(jobSnapshot));
  return { personaVersionId: "persona-a", jobVersionId: "jv-a" };
}

function scoringClient(payload: unknown): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient(
    {
      baseUrl: "https://llm.example.test/v1",
      apiKey: "k",
      model: "test-model",
      timeoutMs: 100,
    },
    vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(payload) } }],
          }),
          { status: 200 },
        ),
      ),
    ),
  );
}

const validScoringPayload = {
  skillFit: {
    score: 70,
    reasons: ["TypeScript経験が要件に合致"],
    evidenceRefs: ["ev-skills", "job:req:1"],
  },
  cultureValueFit: {
    score: 60,
    reasons: ["透明性と自律性の親和性"],
    evidenceRefs: ["job:value:1"],
  },
  difficultyGap: {
    score: 40,
    reasons: ["年数要件にやや不足"],
    evidenceRefs: ["job:req:1"],
  },
};

let temporaryDirectory: string;
let connection: DatabaseConnection;
let service: ScoringService;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "prizgram-score-"),
  );
  connection = createDatabase(path.join(temporaryDirectory, "score.sqlite"));
  migrateDatabase(connection, migrationsFolder);
  service = new ScoringService(connection);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error("expected rejection");
}

describe("ScoringService.score", () => {
  it("persists three axes with model/prompt provenance and dedupes identical runs", async () => {
    const ids = seedPersonaAndJob();
    const options = {
      client: scoringClient(validScoringPayload),
      model: "test-model",
    };
    const first = await service.score(userA, ids, options);
    expect(first.duplicate).toBe(false);
    expect(first.axes.skillFit.score).toBe(70);

    // Identical generation conditions -> stored row returned.
    const second = await service.score(userA, ids, options);
    expect(second.duplicate).toBe(true);
    expect(second.scoreId).toBe(first.scoreId);
    expect(
      (
        connection.sqlite
          .prepare("select count(*) c from match_scores")
          .get() as { c: number }
      ).c,
    ).toBe(1);
  });

  it("rejects fabricated evidence references without writing", async () => {
    const ids = seedPersonaAndJob();
    await expect(
      errorCode(
        service.score(userA, ids, {
          client: scoringClient({
            ...validScoringPayload,
            skillFit: {
              score: 90,
              reasons: ["捏造"],
              evidenceRefs: ["ev-fake"],
            },
          }),
          model: "test-model",
        }),
      ),
    ).resolves.toBe("UPSTREAM_INVALID_RESPONSE");
    expect(
      (
        connection.sqlite
          .prepare("select count(*) c from match_scores")
          .get() as { c: number }
      ).c,
    ).toBe(0);
  });

  it("keeps users isolated from other personas and jobs", async () => {
    const ids = seedPersonaAndJob();
    await expect(
      errorCode(
        service.score(userB, ids, {
          client: scoringClient(validScoringPayload),
          model: "m",
        }),
      ),
    ).resolves.toBe("NOT_FOUND");
    expect(service.latestForJob(userB.id, "job-a")).toBeUndefined();
  });
});
