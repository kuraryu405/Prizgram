import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDatabase,
  migrateDatabase,
  personaVersions,
  type DatabaseConnection,
} from "@prizgram/db";

import { AppError } from "../api";
import { OpenAiCompatibleClient } from "../llm";
import { PersonaService, buildPersonaMessages } from "./service";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../packages/db/drizzle",
);

const userA = { id: "user-a", loginId: "student.one" };
const userB = { id: "user-b", loginId: "student.two" };

function answerText(questionId: string): string {
  return ANSWER_TEXTS[questionId] ?? "";
}

const ANSWER_TEXTS: Record<string, string> = {
  q1_skills:
    "TypeScriptでのWebアプリ開発を2年間継続しています。テスト駆動開発も学習中です。",
  q2_experiences:
    "大学のプロジェクトでタスク管理アプリを開発し、チームのリーダーとしてリリースまで担当しました。",
  q3_strengths:
    "分解して考えることが得意で、複雑な要件を小さなタスクに落とし込めます。",
  q4_weaknesses:
    "発表の経験が少なく、大勢の前でのプレゼンテーションに不安があります。",
  q5_values:
    "透明性のあるフィードバック文化と、技術への素直な向き合い方を重視します。",
  q6_preferences:
    "職種はフロントエンドエンジニア、業界はSaaS、働き方はハイブリッド、勤務地は東京を希望します。",
};

function personaProviderPayload(): unknown {
  return {
    skills: [
      {
        name: "TypeScript",
        level: "intermediate",
        evidenceRefs: ["ev-skills"],
      },
      {
        name: "テスト駆動開発",
        level: "beginner",
        evidenceRefs: ["ev-skills"],
      },
    ],
    strengths: ["複雑な要件を小さなタスクへ分解できる"],
    weaknesses: ["大人数前でのプレゼンテーションに不安がある"],
    values: ["透明性のあるフィードバック"],
    preferences: {
      roles: ["フロントエンドエンジニア"],
      industries: ["SaaS"],
      workStyles: ["hybrid"],
      locations: ["東京"],
    },
    experiences: [
      {
        title: "タスク管理アプリ開発",
        description:
          "大学のプロジェクトでチームリーダーとして開発とリリースを担当。",
        startedOn: null,
        endedOn: null,
        evidenceRefs: ["ev-experiences"],
      },
    ],
    evidence: [
      {
        id: "ev-skills",
        sourceType: "user_input",
        sourceId: "q1_skills",
        summary: "TypeScriptでのWeb開発経験2年と回答",
      },
      {
        id: "ev-experiences",
        sourceType: "user_input",
        sourceId: "q2_experiences",
        summary: "大学プロジェクトでリーダーを担当したと回答",
      },
      {
        id: "ev-values",
        sourceType: "user_input",
        sourceId: "q5_values",
        summary: "透明性を重視すると回答",
      },
      {
        id: "ev-pref",
        sourceType: "user_input",
        sourceId: "q6_preferences",
        summary: "フロントエンド/SaaS/ハイブリッド/東京を希望",
      },
    ],
    confidence: 0.7,
  };
}

function clientReturning(payload: unknown): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient(
    {
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
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

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error("expected rejection");
}

let temporaryDirectory: string;
let connection: DatabaseConnection;
let service: PersonaService;

function startAndAnswer(userId: string): { intakeId: string } {
  const started = service.startIntake(userId);
  const user = userId === userA.id ? userA : userB;
  for (const [questionId, answer] of Object.entries(ANSWER_TEXTS)) {
    service.saveAnswer(user, started.intakeId, { questionId, answer });
  }
  return started;
}

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "prizgram-persona-"),
  );
  connection = createDatabase(path.join(temporaryDirectory, "persona.sqlite"));
  migrateDatabase(connection, migrationsFolder);
  connection.sqlite
    .prepare("insert into users (id) values (?), (?)")
    .run(userA.id, userB.id);
  service = new PersonaService(connection);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("PersonaService intake", () => {
  it("starts one in-progress intake and resumes it instead of creating more", () => {
    const first = service.startIntake(userA.id);
    const second = service.startIntake(userA.id);
    expect(second.intakeId).toBe(first.intakeId);
    expect(second.status).toBe("in_progress");
  });

  it("overwrites an answer in place, keeping its row id stable", () => {
    const started = service.startIntake(userA.id);
    service.saveAnswer(userA, started.intakeId, {
      questionId: "q1_skills",
      answer: answerText("q1_skills"),
    });
    const firstRow = connection.sqlite
      .prepare(
        "select id, answer from persona_intake_answers where question_id = 'q1_skills'",
      )
      .get() as { id: string; answer: string } | undefined;
    expect(firstRow?.answer).toBe(answerText("q1_skills"));

    service.saveAnswer(userA, started.intakeId, {
      questionId: "q1_skills",
      answer: "更新後のスキル回答です。",
    });
    const rows = connection.sqlite
      .prepare(
        "select id, answer from persona_intake_answers where question_id = 'q1_skills'",
      )
      .all() as Array<{ id: string; answer: string }>;
    expect(rows).toHaveLength(1);
    const updatedRow = rows[0];
    if (updatedRow === undefined || firstRow === undefined) {
      throw new Error("expected the overwritten row to exist");
    }
    expect(updatedRow.id).toBe(firstRow.id);
    expect(updatedRow.answer).toBe("更新後のスキル回答です。");
  });
});

describe("PersonaService.generatePersona", () => {
  it("generates v1 with provenance and rewrites evidence sourceIds to real answer ids", async () => {
    const { intakeId } = startAndAnswer(userA.id);

    const result = await service.generatePersona(
      userA,
      { intakeId, requestId: "req-test-0001" },
      {
        client: clientReturning(personaProviderPayload()),
        model: "test-model",
      },
    );

    expect(result.duplicate).toBe(false);
    expect(result.version).toBe(1);

    const rows = connection.db.select().from(personaVersions).all();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("row missing");

    // Every evidence sourceId now points at a real answer row id.
    const answerIds = new Set(
      (
        connection.sqlite
          .prepare("select id from persona_intake_answers where user_id = ?")
          .all(userA.id) as Array<{ id: string }>
      ).map((r) => r.id),
    );
    for (const evidence of row.snapshot.evidence) {
      expect(evidence.sourceType).toBe("user_input");
      if (evidence.sourceId !== undefined) {
        expect(answerIds.has(evidence.sourceId)).toBe(true);
      }
    }
    expect(row.provenance.sourceIds).toContain(`persona-intake:${intakeId}`);
    expect(row.provenance.sourceIds).toContain("req-test-0001");
    expect(row.model).toBe("test-model");
    expect(row.promptVersion).toBe("persona-v1");

    const state = service.getIntake(userA.id, intakeId);
    expect(state.status).toBe("completed");
  });

  it("returns the stored version on retry without invoking the client again", async () => {
    const { intakeId } = startAndAnswer(userA.id);

    const first = await service.generatePersona(
      userA,
      { intakeId },
      {
        client: clientReturning(personaProviderPayload()),
        model: "test-model",
      },
    );
    const failing = new OpenAiCompatibleClient(
      {
        baseUrl: "https://llm.example.test/v1",
        apiKey: "k",
        model: "m",
        timeoutMs: 100,
      },
      vi.fn<typeof fetch>().mockRejectedValue(new Error("must not be called")),
    );
    const second = await service.generatePersona(
      userA,
      { intakeId },
      { client: failing, model: "test-model" },
    );
    expect(second.personaVersionId).toBe(first.personaVersionId);
    expect(second.duplicate).toBe(true);
    expect(service.listVersions(userA.id)).toHaveLength(1);
  });

  it("refuses generation until every question is answered", async () => {
    const started = service.startIntake(userA.id);
    service.saveAnswer(userA, started.intakeId, {
      questionId: "q1_skills",
      answer: answerText("q1_skills") ?? "",
    });
    await expect(
      errorCode(
        service.generatePersona(
          userA,
          { intakeId: started.intakeId },
          { client: clientReturning(personaProviderPayload()), model: "m" },
        ),
      ),
    ).resolves.toBe("INTAKE_INCOMPLETE");
    expect(service.getIntake(userA.id, started.intakeId).status).toBe(
      "in_progress",
    );
  });

  it("rolls back the completion claim when evidence validation fails", async () => {
    const started = startAndAnswer(userA.id);
    const payload = personaProviderPayload() as Record<string, unknown> & {
      evidence: Array<Record<string, unknown>>;
    };
    payload.skills = [];
    payload.experiences = [];
    payload.evidence = [
      {
        id: "ev-x",
        sourceType: "user_input",
        sourceId: "q99_unknown",
        summary: "unknown origin",
      },
    ];

    await expect(
      errorCode(
        service.generatePersona(
          userA,
          { intakeId: started.intakeId },
          { client: clientReturning(payload), model: "m" },
        ),
      ),
    ).resolves.toBe("UPSTREAM_INVALID_RESPONSE");

    expect(service.listVersions(userA.id)).toHaveLength(0);
    expect(service.getIntake(userA.id, started.intakeId).status).toBe(
      "in_progress",
    );

    // Retry succeeds after the failed attempt released the claim.
    const retried = await service.generatePersona(
      userA,
      { intakeId: started.intakeId },
      { client: clientReturning(personaProviderPayload()), model: "m" },
    );
    expect(retried.version).toBe(1);
  });

  it("rejects non-user-input evidence sources outright", async () => {
    const started = startAndAnswer(userA.id);
    const base = personaProviderPayload() as {
      evidence: Array<Record<string, unknown>>;
    };
    base.evidence = base.evidence.map((entry) => ({
      ...entry,
      sourceType: "llm_inference",
    }));
    await expect(
      errorCode(
        service.generatePersona(
          userA,
          { intakeId: started.intakeId },
          { client: clientReturning(base), model: "m" },
        ),
      ),
    ).resolves.toBe("UPSTREAM_INVALID_RESPONSE");
    expect(service.listVersions(userA.id)).toHaveLength(0);
  });

  it("keeps users isolated across intake answers, versions, and errors", async () => {
    const otherStart = service.startIntake(userB.id);
    await expect(
      errorCode(
        service.generatePersona(
          userA,
          { intakeId: otherStart.intakeId },
          { client: clientReturning(personaProviderPayload()), model: "m" },
        ),
      ),
    ).resolves.toBe("NOT_FOUND");
    expect(service.listVersions(userB.id)).toHaveLength(0);
  });
});

describe("buildPersonaMessages", () => {
  it("delimits each answer with its public question id and pins evidence rules", () => {
    const messages = buildPersonaMessages([
      { questionId: "q1_skills", answer: "回答本文" },
    ]);
    const userMessage = messages.find((message) => message.role === "user");
    const systemMessage = messages.find((message) => message.role === "system");
    expect(userMessage?.content).toContain('<answer id="q1_skills">');
    expect(systemMessage?.content).toContain("user_input");
  });
});
