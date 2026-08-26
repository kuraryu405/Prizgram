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
import type { JobSnapshot, PersonaSnapshot } from "@prizgram/shared";

import { AppError } from "../api";
import { OpenAiCompatibleClient } from "../llm";
import {
  SCORING_AXES,
  ScoringService,
  allowedEvidenceRefSet,
  buildScoringMessages,
} from "./service";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../packages/db/drizzle",
);

const userA = { id: "user-a" };
const userB = { id: "user-b" };

const personaSnapshot: PersonaSnapshot = {
  skills: [
    { name: "TypeScript", level: "intermediate", evidenceRefs: ["ev:ts"] },
  ],
  strengths: ["学習速度"],
  weaknesses: [],
  values: ["自律性"],
  preferences: { roles: [], industries: [], workStyles: [], locations: [] },
  experiences: [
    {
      title: "Webアプリ開発",
      description: "チームでWebアプリを開発した。",
      evidenceRefs: ["ev:web"],
    },
  ],
  evidence: [
    {
      id: "ev:ts",
      sourceType: "user_input",
      sourceId: "ev:web",
      summary: "TypeScriptでの実装経験",
    },
    {
      id: "ev:web",
      sourceType: "user_input",
      summary: "Webアプリ開発経験",
    },
  ],
  confidence: 0.7,
};

const jobSnapshot: JobSnapshot = {
  company: "株式会社サンプル",
  role: "フロントエンドエンジニア",
  employmentType: "internship",
  description: "ReactとTypeScriptを使う開発インターン。",
  requirements: [{ id: "job:req:1", text: "TypeScriptの実装経験" }],
  desiredSkills: [],
  cultureValues: [{ id: "job:culture:1", text: "自律的に動く文化" }],
  difficulty: {
    level: "competitive",
    evidenceRefs: ["job:req:1"],
  },
  source: {
    kind: "user_provided",
    name: "ユーザー提供の求人票",
    retrievedAt: "2026-01-01T00:00:00.000Z",
  },
};

function insertPersonaVersion(
  userId: string,
  version: number,
  snapshot: PersonaSnapshot = personaSnapshot,
): string {
  const id = `persona-v-${userId}-${version}`;
  connection.sqlite
    .prepare("insert into users (id) values (?) on conflict do nothing")
    .run(userId);
  connection.sqlite
    .prepare(
      `insert into persona_versions (id, user_id, version, snapshot, provenance)
       values (?, ?, ?, ?, '{}')`,
    )
    .run(id, userId, version, JSON.stringify(snapshot));
  return id;
}

function insertJobVersion(
  userId: string,
  jobId: string,
  version: number,
  snapshot: JobSnapshot = jobSnapshot,
): string {
  const id = `job-ver-${jobId}-${version}`;
  connection.sqlite
    .prepare("insert into users (id) values (?) on conflict do nothing")
    .run(userId);
  connection.sqlite
    .prepare(
      "insert into jobs (id, user_id) values (?, ?) on conflict do nothing",
    )
    .run(jobId, userId);
  const model: string | null = null;
  const promptVersion: string | null = null;
  connection.sqlite
    .prepare(
      `insert into job_versions (id, user_id, job_id, version, snapshot, content_hash, model, prompt_version)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      jobId,
      version,
      JSON.stringify(snapshot),
      `hash-${jobId}-${version}`,
      model,
      promptVersion,
    );
  return id;
}

function scoringPayload(overrides?: {
  skillFitScore?: number;
  cultureValueFitScore?: number;
  difficultyGapScore?: number;
  fabricatedRef?: string;
}): Record<
  string,
  { score: number; reasons: string[]; evidenceRefs: string[] }
> {
  return {
    skillFit: {
      score: overrides?.skillFitScore ?? 70,
      reasons: ["要件に合致する実装経験がある"],
      evidenceRefs:
        overrides?.fabricatedRef !== undefined
          ? [overrides.fabricatedRef]
          : ["ev:ts", "job:req:1"],
    },
    cultureValueFit: {
      score: overrides?.cultureValueFitScore ?? 60,
      reasons: ["自律的な文化がペルソナの価値観と整合する"],
      evidenceRefs:
        overrides?.fabricatedRef !== undefined
          ? [overrides.fabricatedRef]
          : ["ev:ts", "job:culture:1"],
    },
    difficultyGap: {
      score: overrides?.difficultyGapScore ?? 30,
      reasons: ["実装経験から大きなギャップはない"],
      evidenceRefs: ["job:req:1", "ev:web"],
    },
  };
}

function clientReturning(payload: unknown): {
  client: OpenAiCompatibleClient;
  calls: () => number;
} {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(payload) } }],
        }),
        { status: 200 },
      ),
    ),
  );
  return {
    client: new OpenAiCompatibleClient(
      {
        baseUrl: "https://llm.example.test/v1",
        apiKey: "test-key",
        model: "test-model",
        timeoutMs: 100,
      },
      fetchMock,
    ),
    calls: () => fetchMock.mock.calls.length,
  };
}

let temporaryDirectory: string;
let connection: DatabaseConnection;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "prizgram-score-"),
  );
  connection = createDatabase(path.join(temporaryDirectory, "scoring.sqlite"));
  migrateDatabase(connection, migrationsFolder);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("ScoringService.evaluateJob", () => {
  it("stores a three-axis evaluation pinning versions and provenance", async () => {
    const service = new ScoringService(connection);
    insertPersonaVersion(userA.id, 1);
    insertJobVersion(userA.id, "job-1", 1);

    const result = await service.evaluateJob(userA.id, "job-1", {
      client: clientReturning(scoringPayload()).client,
      model: "test-model",
      now: () => new Date("2026-02-01T00:00:00.000Z"),
    });

    expect(result.duplicate).toBe(false);
    expect(result.detail.personaVersionId).toBe(`persona-v-user-a-1`);
    expect(result.detail.jobVersionId).toBe(`job-ver-job-1-1`);
    expect(result.detail.model).toBe("test-model");
    expect(result.detail.promptVersion).toBe("scoring-v1");
    expect(Object.keys(result.detail.axes).sort()).toEqual(
      [...SCORING_AXES].sort(),
    );
    expect(result.detail.axes.skillFit.score).toBe(70);
    expect(result.detail.axes.difficultyGap.score).toBe(30);
  });

  it("reuses the stored row for identical generation conditions", async () => {
    const service = new ScoringService(connection);
    insertPersonaVersion(userA.id, 1);
    insertJobVersion(userA.id, "job-1", 1);
    const llm = clientReturning(scoringPayload());

    const first = await service.evaluateJob(userA.id, "job-1", {
      client: llm.client,
      model: "test-model",
    });
    const second = await service.evaluateJob(userA.id, "job-1", {
      client: llm.client,
      model: "test-model",
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.detail.scoreId).toBe(first.detail.scoreId);
    // The client was used only once.
    expect(llm.calls()).toBe(1);
  });

  it("rejects a cross-user job with NOT_FOUND", async () => {
    const service = new ScoringService(connection);
    insertPersonaVersion(userB.id, 1);
    insertJobVersion(userA.id, "job-a", 1);

    await expect(
      service.evaluateJob(userB.id, "job-a", {
        client: clientReturning(scoringPayload()).client,
        model: "test-model",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("requires a persona version before evaluating", async () => {
    const service = new ScoringService(connection);
    insertPersonaVersion(userA.id, 1);
    insertJobVersion(userA.id, "job-1", 1);
    // Remove persona rows to simulate a user without any generated persona.
    connection.sqlite.prepare("delete from persona_versions").run();

    await expect(
      service.evaluateJob(userA.id, "job-1", {
        client: clientReturning(scoringPayload()).client,
        model: "test-model",
      }),
    ).rejects.toMatchObject({ code: "PERSONA_REQUIRED", status: 409 });
  });

  it("rejects fabricated evidence references without writing anything", async () => {
    const service = new ScoringService(connection);
    insertPersonaVersion(userA.id, 1);
    insertJobVersion(userA.id, "job-1", 1);
    const payload = scoringPayload({ fabricatedRef: "fabricated:id" });

    await expect(
      service.evaluateJob(userA.id, "job-1", {
        client: clientReturning(payload).client,
        model: "test-model",
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE", status: 502 });
    expect(
      connection.sqlite.prepare("select count(*) as c from match_scores").get(),
    ).toEqual({ c: 0 });
  });

  it("rejects out-of-range scores without writing anything", async () => {
    const service = new ScoringService(connection);
    insertPersonaVersion(userA.id, 1);
    insertJobVersion(userA.id, "job-1", 1);
    const payload = scoringPayload({ skillFitScore: 101 });

    await expect(
      service.evaluateJob(userA.id, "job-1", {
        client: clientReturning(payload).client,
        model: "test-model",
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE", status: 502 });
    expect(
      connection.sqlite.prepare("select count(*) as c from match_scores").get(),
    ).toEqual({ c: 0 });
  });

  it("writes nothing when the LLM call times out", async () => {
    const service = new ScoringService(connection);
    insertPersonaVersion(userA.id, 1);
    insertJobVersion(userA.id, "job-1", 1);
    const failing = new OpenAiCompatibleClient(
      {
        baseUrl: "https://llm.example.test/v1",
        apiKey: "test-key",
        model: "test-model",
        timeoutMs: 100,
      },
      vi.fn<typeof fetch>().mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error("network down")), 300);
          }),
      ),
    );

    await expect(
      service.evaluateJob(userA.id, "job-1", {
        client: failing,
        model: "test-model",
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(
      connection.sqlite.prepare("select count(*) as c from match_scores").get(),
    ).toEqual({ c: 0 });
  });

  it("evaluates the latest versions only", async () => {
    const service = new ScoringService(connection);
    insertPersonaVersion(userA.id, 1);
    insertJobVersion(userA.id, "job-1", 1);
    insertJobVersion(userA.id, "job-1", 2);
    insertPersonaVersion(userA.id, 2);

    const result = await service.evaluateJob(userA.id, "job-1", {
      client: clientReturning(scoringPayload()).client,
      model: "test-model",
    });

    expect(result.detail.jobVersionId).toBe("job-ver-job-1-2");
    expect(result.detail.personaVersionId).toBe("persona-v-user-a-2");
  });

  it("accepts explicit persona/job version targets and rejects cross-user ids", async () => {
    const service = new ScoringService(connection);
    insertPersonaVersion(userA.id, 1);
    insertJobVersion(userA.id, "job-1", 1);
    insertJobVersion(userA.id, "job-1", 2);

    const explicit = await service.evaluateJob(userA.id, "job-1", {
      client: clientReturning(scoringPayload()).client,
      model: "test-model",
      personaVersionId: "persona-v-user-a-1",
      jobVersionId: "job-ver-job-1-1",
    });
    expect(explicit.detail.jobVersionId).toBe("job-ver-job-1-1");
    expect(explicit.duplicate).toBe(false);

    // Another user's version id is rejected by the ownership filter.
    await expect(
      service.evaluateJob(userA.id, "job-1", {
        client: clientReturning(scoringPayload()).client,
        model: "test-model",
        jobVersionId: "does-not-exist",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("ScoringService.getLatestScore / listScores", () => {
  it("returns undefined when nothing was evaluated yet", () => {
    const service = new ScoringService(connection);
    insertJobVersion(userA.id, "job-1", 1);
    expect(service.getLatestScore(userA.id, "job-1")).toBeUndefined();
  });

  it("lists evaluations newest first", async () => {
    const service = new ScoringService(connection);
    insertPersonaVersion(userA.id, 1);
    insertJobVersion(userA.id, "job-1", 1);
    insertJobVersion(userA.id, "job-1", 2);

    const v1 = await service.evaluateJob(userA.id, "job-1", {
      client: clientReturning(scoringPayload()).client,
      model: "model-v1",
      now: () => new Date("2026-02-01T00:00:00.000Z"),
    });
    // A different model creates a distinct generation tuple for the same pair.
    const v2 = await service.evaluateJob(userA.id, "job-1", {
      client: clientReturning(scoringPayload({ skillFitScore: 80 })).client,
      model: "model-v2",
      now: () => new Date("2026-02-02T00:00:00.000Z"),
    });

    expect(v1.duplicate).toBe(false);
    expect(v2.duplicate).toBe(false);
    const list = service.listScores(userA.id, "job-1");
    expect(list.map((entry) => entry.model)).toEqual(["model-v2", "model-v1"]);
    expect(list[0]?.axes.skillFit.score).toBe(80);
    expect(service.getLatestScore(userA.id, "job-1")?.scoreId).toBe(
      list[0]?.scoreId,
    );
  });
});

describe("ScoringService freshness (#129)", () => {
  it("treats a score pinned to an old persona version as stale", async () => {
    const service = new ScoringService(connection);
    insertPersonaVersion(userA.id, 1);
    insertJobVersion(userA.id, "job-1", 1);
    await service.evaluateJob(userA.id, "job-1", {
      client: clientReturning(scoringPayload()).client,
      model: "test-model",
    });
    // Latest history exists but current (fresh) should be that score
    expect(service.getCurrentScore(userA.id, "job-1")).toBeDefined();
    expect(service.describeFreshness(userA.id, "job-1").status).toBe("fresh");

    insertPersonaVersion(userA.id, 2);
    // History newest still exists
    expect(service.getLatestScore(userA.id, "job-1")).toBeDefined();
    // Fresh is now undefined because persona moved
    expect(service.getCurrentScore(userA.id, "job-1")).toBeUndefined();
    const freshness = service.describeFreshness(userA.id, "job-1");
    expect(freshness.status).toBe("stale");
    expect(freshness.detail).toBeDefined();
    // Re-evaluating against v2 restores freshness
    await service.evaluateJob(userA.id, "job-1", {
      client: clientReturning(scoringPayload()).client,
      model: "test-model",
    });
    expect(service.getCurrentScore(userA.id, "job-1")).toBeDefined();
    expect(service.describeFreshness(userA.id, "job-1").status).toBe("fresh");
  });

  it("treats a score pinned to an old job version as stale", async () => {
    const service = new ScoringService(connection);
    insertPersonaVersion(userA.id, 1);
    insertJobVersion(userA.id, "job-1", 1);
    await service.evaluateJob(userA.id, "job-1", {
      client: clientReturning(scoringPayload()).client,
      model: "test-model",
    });
    insertJobVersion(userA.id, "job-1", 2);
    expect(service.getLatestScore(userA.id, "job-1")).toBeDefined();
    expect(service.getCurrentScore(userA.id, "job-1")).toBeUndefined();
    expect(service.describeFreshness(userA.id, "job-1").status).toBe("stale");
  });

  it("batch current scores avoid N+1 and respect freshness", async () => {
    const service = new ScoringService(connection);
    insertPersonaVersion(userA.id, 1);
    insertJobVersion(userA.id, "job-1", 1);
    insertJobVersion(userA.id, "job-2", 1);
    insertJobVersion(userA.id, "job-3", 1);
    await service.evaluateJob(userA.id, "job-1", {
      client: clientReturning(scoringPayload()).client,
      model: "test-model",
    });
    await service.evaluateJob(userA.id, "job-2", {
      client: clientReturning(scoringPayload()).client,
      model: "test-model",
    });
    // job-3 stays unscored

    const fresh = service.getCurrentScores(userA.id, ["job-1", "job-2", "job-3"]);
    expect(fresh.size).toBe(2);
    expect(fresh.has("job-1")).toBe(true);
    expect(fresh.has("job-2")).toBe(true);
    expect(fresh.has("job-3")).toBe(false);

    // Historical batch includes same (since all fresh)
    const hist = service.getLatestScores(userA.id, ["job-1", "job-2", "job-3"]);
    expect(hist.size).toBe(2);

    // After persona update, fresh batch should be empty
    insertPersonaVersion(userA.id, 2);
    expect(service.getCurrentScores(userA.id, ["job-1", "job-2"]).size).toBe(0);
    // Historical still returns old
    expect(service.getLatestScores(userA.id, ["job-1", "job-2"]).size).toBe(2);
  });
});

describe("scoring helpers", () => {
  it("collects persona evidence and job signal ids as the citation universe", () => {
    const refs = allowedEvidenceRefSet(personaSnapshot, jobSnapshot);
    expect(refs.has("ev:ts")).toBe(true);
    expect(refs.has("ev:web")).toBe(true);
    expect(refs.has("job:req:1")).toBe(true);
    expect(refs.has("job:culture:1")).toBe(true);
    expect(refs.size).toBe(4);
  });

  it("delimits external data inside the prompt", () => {
    const messages = buildScoringMessages(personaSnapshot, jobSnapshot);
    const userContent = messages[1]?.content ?? "";
    expect(userContent).toContain("<persona>");
    expect(userContent).toContain("</persona>");
    expect(userContent).toContain("<job_posting>");
    expect(userContent).toContain("</job_posting>");
    expect(messages[0]?.role).toBe("system");
  });
});
