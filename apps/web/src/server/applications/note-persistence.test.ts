import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { jobSnapshotSchema } from "@prizgram/shared";
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from "@prizgram/db";

import { ApplicationService } from "./service";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../packages/db/drizzle",
);

const user = { id: "note-user", loginId: "note.user" };

let temporaryDirectory: string;
let connection: DatabaseConnection;
let service: ApplicationService;

function seedJob(): void {
  const snapshot = jobSnapshotSchema.parse({
    company: "株式会社メモテスト",
    role: "エンジニア",
    employmentType: "internship",
    description: "Application note persistence regression test",
    requirements: [{ id: "job:req:note", text: "TypeScript" }],
    desiredSkills: [],
    cultureValues: [],
    difficulty: { level: "entry", evidenceRefs: ["job:req:note"] },
    source: {
      kind: "user_provided" as const,
      name: "test",
      retrievedAt: "2026-08-27T00:00:00Z",
    },
  });

  connection.sqlite.prepare("insert into users (id) values (?)").run(user.id);
  connection.sqlite
    .prepare("insert into jobs (id, user_id) values (?, ?)")
    .run("job-note", user.id);
  connection.sqlite
    .prepare(
      "insert into job_versions (id, user_id, job_id, version, snapshot, content_hash) values (?, ?, ?, 1, ?, ?)",
    )
    .run(
      "job-note-v1",
      user.id,
      "job-note",
      JSON.stringify(snapshot),
      "note-hash",
    );
}

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "prizgram-note-"));
  connection = createDatabase(path.join(temporaryDirectory, "note.sqlite"));
  migrateDatabase(connection, migrationsFolder);
  service = new ApplicationService(connection);
  seedJob();
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("Application note persistence", () => {
  it("persists the initial note as current state and initial history", () => {
    const created = service.createFromJob(user, {
      jobId: "job-note",
      note: "初回メモ",
    });

    expect(created.note).toBe("初回メモ");

    const detail = service.getApplicationDetail(user.id, created.applicationId);
    expect(detail.note).toBe("初回メモ");
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]?.note).toBe("初回メモ");
  });

  it("updates and clears the current note without creating stage events", () => {
    const created = service.createFromJob(user, {
      jobId: "job-note",
      note: "before",
    });

    const updated = service.updateApplication(user, created.applicationId, {
      note: "after",
    });
    expect(updated.note).toBe("after");
    expect(updated.events).toHaveLength(1);

    const cleared = service.updateApplication(user, created.applicationId, {
      note: null,
    });
    expect(cleared.note).toBeUndefined();
    expect(cleared.events).toHaveLength(1);
  });

  it("stores status+note in current state and history, then preserves note on status-only updates", () => {
    const created = service.createFromJob(user, {
      jobId: "job-note",
      note: "keep me",
    });

    const transitioned = service.updateApplication(user, created.applicationId, {
      status: "applying",
      note: "応募準備中",
    });
    expect(transitioned.note).toBe("応募準備中");
    expect(transitioned.events[1]).toMatchObject({
      fromStatus: "saved",
      toStatus: "applying",
      note: "応募準備中",
    });

    const statusOnly = service.updateApplication(user, created.applicationId, {
      status: "submitted",
    });
    expect(statusOnly.note).toBe("応募準備中");
    expect(statusOnly.events[2]).toMatchObject({
      fromStatus: "applying",
      toStatus: "submitted",
    });
    expect(statusOnly.events[2]?.note).toBeUndefined();
  });
});
