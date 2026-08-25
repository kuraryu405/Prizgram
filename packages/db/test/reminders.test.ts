import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabase,
  migrateDatabase,
  ReminderService,
  type DatabaseConnection,
} from "@prizgram/db";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../drizzle");

const DAY_MS = 24 * 3_600_000;
const HOUR_MS = 3_600_000;

const userA = "user-a";

let temporaryDirectory: string;
let connection: DatabaseConnection;
let service: ReminderService;

function seedApplication(applicationId: string, status: string): void {
  const jobId = `job-for-${applicationId}`;
  connection.sqlite
    .prepare("insert into users (id) values (?) on conflict do nothing")
    .run(userA);
  connection.sqlite
    .prepare("insert into jobs (id, user_id) values (?, ?)")
    .run(jobId, userA);
  connection.sqlite
    .prepare(
      "insert into applications (id, user_id, job_id, status) values (?, ?, ?, ?)",
    )
    .run(applicationId, userA, jobId, status);
}

function seedDeadline(
  deadlineId: string,
  applicationId: string,
  dueAtMs: number,
  options: { completed?: boolean; kind?: string } = {},
): void {
  connection.sqlite
    .prepare(
      `insert into application_deadlines
         (id, user_id, application_id, kind, title, due_at, timezone, completed_at)
       values (?, ?, ?, ?, ?, ?, 'UTC', ${options.completed === true ? "?" : "null"})`,
    )
    .run(
      `${deadlineId}-row`,
      userA,
      applicationId,
      options.kind ?? "document",
      deadlineId,
      dueAtMs,
      ...(options.completed === true ? [Date.now()] : []),
    );
}

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "prizgram-rem-"));
  connection = createDatabase(path.join(temporaryDirectory, "rem.sqlite"));
  migrateDatabase(connection, migrationsFolder);
  service = new ReminderService(connection.db);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("ReminderService.generateDueReminders", () => {
  it("creates one reminder per entered bucket with deterministic priorities", () => {
    seedApplication("app-a", "interview");
    const now = new Date("2026-08-26T00:00:00Z");
    // 12h ahead -> overdue no / 24h yes / 3d yes / 7d yes
    seedDeadline("dl-12h", "app-a", now.getTime() + 12 * 3_600_000);
    const summary = service.generateDueReminders({ now });
    expect(summary.scanned).toBe(1);
    expect(summary.created).toBe(3);

    const list = service.listActive(userA);
    expect(list[0]?.priority).toBe("urgent");
    expect(list.map((reminder) => reminder.priority)).toEqual([
      "urgent",
      "high",
      "medium",
    ]);
  });

  it("is idempotent across repeated and concurrent-style runs", () => {
    seedApplication("app-a", "interview");
    const now = new Date("2026-08-26T00:00:00Z");
    seedDeadline("dl-x", "app-a", now.getTime() + 6 * 3_600_000);

    expect(service.generateDueReminders({ now }).created).toBe(3);
    // Re-run at the same instant and slightly later within the same bucket.
    expect(
      service.generateDueReminders({ now: new Date(now.getTime() + 60_000) })
        .created,
    ).toBe(0);
    expect(service.listActive(userA)).toHaveLength(3);
  });

  it("skips completed deadlines and terminal applications", () => {
    const now = new Date("2026-08-26T00:00:00Z");
    seedApplication("app-open", "interview");
    seedApplication("app-rejected", "rejected");
    seedDeadline("dl-done", "app-open", now.getTime() + DAY_MS, {
      completed: true,
    });
    seedDeadline("dl-terminal", "app-rejected", now.getTime() + DAY_MS);

    const summary = service.generateDueReminders({ now });
    expect(summary.created).toBe(0);
    expect(service.listActive(userA)).toHaveLength(0);
  });

  it("never resurrects dismissed reminders via the dedupe key", () => {
    seedApplication("app-a", "interview");
    const now = new Date("2026-08-26T00:00:00Z");
    seedDeadline("dl-dismiss", "app-a", now.getTime() + 2 * HOUR_MS);

    service.generateDueReminders({ now });
    const active = service.listActive(userA);
    for (const reminder of active) {
      expect(service.dismiss(userA, reminder.id)).toBe(true);
    }
    expect(service.listActive(userA)).toHaveLength(0);

    // Later cron runs must not re-create reminders for the same buckets.
    expect(
      service.generateDueReminders({
        now: new Date(now.getTime() + 30 * 60_000),
      }).created,
    ).toBe(0);
    expect(service.listActive(userA)).toHaveLength(0);
  });

  it("escalates a deadline into the next bucket exactly once when time passes", () => {
    seedApplication("app-a", "interview");
    const start = new Date("2026-08-20T00:00:00Z"); // 7d+ ahead? use exact windows
    seedDeadline("dl-escalate", "app-a", start.getTime() + 8 * DAY_MS);

    expect(
      service.generateDueReminders({ now: new Date(start.getTime()) }).created,
    ).toBe(0); // more than 7 days away

    const inside7d = new Date(start.getTime() + DAY_MS); // remaining 7d -> 7d bucket only
    expect(service.generateDueReminders({ now: inside7d }).created).toBe(1);

    const inside3d = new Date(start.getTime() + 5 * DAY_MS); // remaining 3d -> 3d bucket
    expect(service.generateDueReminders({ now: inside3d }).created).toBe(1);

    const inside24h = new Date(start.getTime() + 7 * DAY_MS); // remaining 24h -> 24h bucket
    expect(service.generateDueReminders({ now: inside24h }).created).toBe(1);

    // Three distinct buckets were crossed (7d, 3d, 24h); each produced
    // exactly one reminder.
    expect(service.listActive(userA)).toHaveLength(3);
  });
});
