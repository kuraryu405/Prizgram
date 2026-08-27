import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import {
  applicationDeadlines,
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from "@prizgram/db";

import { DeadlineService } from "./service";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../packages/db/drizzle",
);

const user = { id: "deadline-user", loginId: "deadline.user" };

let temporaryDirectory: string;
let connection: DatabaseConnection;
let service: DeadlineService;

function completedAt(deadlineId: string): Date | null {
  const row = connection.db
    .select({ completedAt: applicationDeadlines.completedAt })
    .from(applicationDeadlines)
    .where(eq(applicationDeadlines.id, deadlineId))
    .get();
  if (row === undefined) throw new Error("deadline missing");
  return row.completedAt;
}

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "prizgram-deadline-completed-"),
  );
  connection = createDatabase(path.join(temporaryDirectory, "deadline.sqlite"));
  migrateDatabase(connection, migrationsFolder);
  connection.sqlite.prepare("insert into users (id) values (?)").run(user.id);
  connection.sqlite
    .prepare("insert into jobs (id, user_id) values ('job-deadline', ?)")
    .run(user.id);
  connection.sqlite
    .prepare(
      "insert into applications (id, user_id, job_id) values ('app-deadline', ?, 'job-deadline')",
    )
    .run(user.id);
  service = new DeadlineService(connection);
});

afterEach(() => {
  vi.useRealTimers();
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("Deadline completedAt idempotency", () => {
  it("preserves the first completion timestamp when completed=true is retried", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T10:00:00Z"));

    const deadline = service.create(user, {
      applicationId: "app-deadline",
      kind: "document",
      title: "ES提出",
      dueLocal: "2026-08-30T12:00",
      timeZone: "UTC",
    });

    service.update(user, deadline.deadlineId, { completed: true });
    const firstCompletedAt = completedAt(deadline.deadlineId);
    expect(firstCompletedAt?.toISOString()).toBe("2026-08-27T10:00:00.000Z");

    vi.setSystemTime(new Date("2026-08-27T11:00:00Z"));
    service.update(user, deadline.deadlineId, { completed: true });
    expect(completedAt(deadline.deadlineId)?.toISOString()).toBe(
      "2026-08-27T10:00:00.000Z",
    );
  });

  it("clears on reopen and records a new timestamp only after a new completion", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T10:00:00Z"));

    const deadline = service.create(user, {
      applicationId: "app-deadline",
      kind: "document",
      title: "ES提出",
      dueLocal: "2026-08-30T12:00",
      timeZone: "UTC",
    });

    service.update(user, deadline.deadlineId, { completed: false });
    expect(completedAt(deadline.deadlineId)).toBeNull();

    service.update(user, deadline.deadlineId, { completed: true });
    service.update(user, deadline.deadlineId, { completed: false });
    expect(completedAt(deadline.deadlineId)).toBeNull();

    vi.setSystemTime(new Date("2026-08-27T12:00:00Z"));
    service.update(user, deadline.deadlineId, { completed: true });
    expect(completedAt(deadline.deadlineId)?.toISOString()).toBe(
      "2026-08-27T12:00:00.000Z",
    );
  });
});
