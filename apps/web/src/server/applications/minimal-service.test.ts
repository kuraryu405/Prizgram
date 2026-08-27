import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from "@prizgram/db";

import {
  MinimalApplicationService,
  minimalApplicationCreateSchema,
} from "./minimal-service";

type StoredApplication = Readonly<{
  user_id: string;
  job_id: string;
  job_version_id: string;
  note: string;
}>;
type StoredJobVersion = Readonly<{ user_id: string; job_id: string }>;
type CountRow = Readonly<{ count: number }>;

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../packages/db/drizzle",
);
const user = { id: "minimal-user", loginId: "minimal.user" };
const applicationSelectSql =
  "select user_id, job_id, job_version_id, note from applications where id = ?";
const jobVersionSelectSql =
  "select user_id, job_id from job_versions where id = ?";
const personaCountSql =
  "select count(*) as count from persona_versions where user_id = ?";

let temporaryDirectory: string;
let connection: DatabaseConnection;
let service: MinimalApplicationService;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "prizgram-minimal-"),
  );
  connection = createDatabase(path.join(temporaryDirectory, "app.sqlite"));
  migrateDatabase(connection, migrationsFolder);
  connection.sqlite.prepare("insert into users (id) values (?)").run(user.id);
  service = new MinimalApplicationService(connection);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("minimalApplicationCreateSchema", () => {
  it("allows the role to be omitted but not blank when provided", () => {
    expect(
      minimalApplicationCreateSchema.safeParse({ company: "株式会社サンプル" })
        .success,
    ).toBe(true);
    expect(
      minimalApplicationCreateSchema.safeParse({
        company: "株式会社サンプル",
        role: "   ",
      }).success,
    ).toBe(false);
  });
});

describe("MinimalApplicationService", () => {
  it("creates a pinned current-stage application without a persona", () => {
    const created = service.create(user, {
      company: "手動株式会社",
      status: "interview",
      stageLabel: "2次面接",
      nextAction: "面接日程を調整",
      note: "紹介経由",
    });

    expect(created.company).toBe("手動株式会社");
    expect(created.role).toBe("職種未設定");
    expect(created.status).toBe("interview");
    expect(created.stageLabel).toBe("2次面接");
    expect(created.nextAction).toBe("面接日程を調整");
    expect(created.note).toBe("紹介経由");
    expect(created.jobVersionId).toBeDefined();
    expect(created.events).toHaveLength(1);
    expect(created.events[0]).toMatchObject({
      sequence: 1,
      toStatus: "interview",
      stageLabel: "2次面接",
      note: "紹介経由",
    });

    const stored = connection.sqlite
      .prepare(applicationSelectSql)
      .get(created.applicationId) as StoredApplication;
    expect(stored.user_id).toBe(user.id);
    expect(stored.note).toBe("紹介経由");
    expect(stored.job_version_id).toBe(created.jobVersionId);

    const pinnedVersion = connection.sqlite
      .prepare(jobVersionSelectSql)
      .get(stored.job_version_id) as StoredJobVersion;
    expect(pinnedVersion).toEqual({ user_id: user.id, job_id: stored.job_id });

    const personaCount = connection.sqlite
      .prepare(personaCountSql)
      .get(user.id) as CountRow;
    expect(personaCount.count).toBe(0);
  });

  it("keeps an explicitly supplied role in the pinned snapshot", () => {
    const created = service.create(user, {
      company: "サンプル合同会社",
      role: "プロダクトエンジニア",
      status: "screening",
      stageLabel: "Webテスト",
    });

    expect(created.role).toBe("プロダクトエンジニア");
    expect(created.appliedRole).toBe("プロダクトエンジニア");
    expect(created.status).toBe("screening");
    expect(created.stageLabel).toBe("Webテスト");
  });
});
