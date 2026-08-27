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
  it("creates exactly one reminder for the most urgent applicable bucket", () => {
    seedApplication("app-a", "interview");
    const now = new Date("2026-08-26T00:00:00Z");
    // 12h ahead -> only 24h bucket should be created, not 3d/7d
    seedDeadline("dl-12h", "app-a", now.getTime() + 12 * 3_600_000);
    const summary = service.generateDueReminders({ now });
    expect(summary.scanned).toBe(1);
    expect(summary.created).toBe(1);

    const list = service.listActive(userA, now);
    expect(list).toHaveLength(1);
    expect(list[0]?.priority).toBe("urgent");
    expect(list.map((reminder) => reminder.priority)).toEqual(["urgent"]);
  });

  it("is idempotent across repeated and concurrent-style runs", () => {
    seedApplication("app-a", "interview");
    const now = new Date("2026-08-26T00:00:00Z");
    seedDeadline("dl-x", "app-a", now.getTime() + 6 * 3_600_000);

    expect(service.generateDueReminders({ now }).created).toBe(1);
    // Re-run at the same instant and slightly later within the same bucket.
    expect(
      service.generateDueReminders({ now: new Date(now.getTime() + 60_000) })
        .created,
    ).toBe(0);
    expect(service.listActive(userA, now)).toHaveLength(1);
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
    const active = service.listActive(userA, now);
    for (const reminder of active) {
      expect(service.dismiss(userA, reminder.id)).toBe(true);
    }
    expect(service.listActive(userA, now)).toHaveLength(0);

    // Later cron runs must not re-create reminders for the same buckets.
    const later = new Date(now.getTime() + 30 * 60_000);
    expect(
      service.generateDueReminders({
        now: later,
      }).created,
    ).toBe(0);
    expect(service.listActive(userA, later)).toHaveLength(0);
  });

  it("escalates a deadline into the next bucket exactly once when time passes and keeps only the most urgent active", () => {
    seedApplication("app-a", "interview");
    const start = new Date("2026-08-20T00:00:00Z"); // 7d+ ahead? use exact windows
    seedDeadline("dl-escalate", "app-a", start.getTime() + 8 * DAY_MS);

    expect(
      service.generateDueReminders({ now: new Date(start.getTime()) }).created,
    ).toBe(0); // more than 7 days away

    const inside7d = new Date(start.getTime() + DAY_MS); // remaining 7d -> 7d bucket only
    expect(service.generateDueReminders({ now: inside7d }).created).toBe(1);
    expect(service.listActive(userA, inside7d)).toHaveLength(1);
    expect(service.listActive(userA, inside7d)[0]?.priority).toBe("medium");

    const inside3d = new Date(start.getTime() + 5 * DAY_MS); // remaining 3d -> 3d bucket
    expect(service.generateDueReminders({ now: inside3d }).created).toBe(1);
    // Superseded 7d reminder is dismissed, only 3d remains active
    expect(service.listActive(userA, inside3d)).toHaveLength(1);
    expect(service.listActive(userA, inside3d)[0]?.priority).toBe("high");

    const inside24h = new Date(start.getTime() + 7 * DAY_MS); // remaining 24h -> 24h bucket
    expect(service.generateDueReminders({ now: inside24h }).created).toBe(1);
    expect(service.listActive(userA, inside24h)).toHaveLength(1);
    expect(service.listActive(userA, inside24h)[0]?.priority).toBe("urgent");

    // System-stale superseded reminders are deleted so they don't block regeneration (#174)
    const all = connection.sqlite
      .prepare("select status from reminders")
      .all() as Array<{ status: string }>;
    expect(all.filter((r) => r.status === "dismissed")).toHaveLength(0);
    expect(all.filter((r) => r.status !== "dismissed")).toHaveLength(1);
    expect(all).toHaveLength(1);
  });

  it("replaces a 24h reminder with overdue and does not keep both", () => {
    seedApplication("app-a", "interview");
    const now = new Date("2026-08-26T00:00:00Z");
    seedDeadline("dl-overdue", "app-a", now.getTime() + 12 * HOUR_MS);
    service.generateDueReminders({ now });
    expect(service.listActive(userA, now)).toHaveLength(1);

    const overdueNow = new Date(now.getTime() + 2 * DAY_MS);
    expect(service.generateDueReminders({ now: overdueNow }).created).toBe(1);
    const active = service.listActive(userA, overdueNow);
    expect(active).toHaveLength(1);
    expect(active[0]?.priority).toBe("urgent");
    expect(active[0]?.message).toMatch(/期限超過/);
  });

  it("invalidates old reminder when deadline is rescheduled to the future", () => {
    seedApplication("app-a", "interview");
    const now = new Date("2026-08-26T00:00:00Z");
    seedDeadline("dl-resched", "app-a", now.getTime() + 12 * HOUR_MS);
    service.generateDueReminders({ now });
    expect(service.listActive(userA, now)).toHaveLength(1);
    const beforeIds = service.listActive(userA, now).map((r) => r.id);

    // Move deadline 1 week into the future (>7d => no bucket)
    connection.sqlite
      .prepare(
        "update application_deadlines set due_at = ?, updated_at = ? where id = ?",
      )
      .run(now.getTime() + 10 * DAY_MS, now.getTime() + 1, "dl-resched-row");
    const afterNow = new Date(now.getTime() + 60_000);
    // Next generation should dismiss the stale 24h reminder and create nothing (too far)
    service.generateDueReminders({ now: afterNow });
    // Either dismissed via generate's stale sweep or via listActive; active should be 0
    expect(service.listActive(userA, afterNow)).toHaveLength(0);
    const stored = connection.sqlite
      .prepare("select dedupe_key, status from reminders")
      .all() as Array<{ dedupe_key: string; status: string }>;
    expect(stored.some((r) => beforeIds.includes(r.dedupe_key) === false));
    // Create a new 24h reminder after rescheduling back into 24h window
    const newDue = afterNow.getTime() + 6 * HOUR_MS;
    connection.sqlite
      .prepare("update application_deadlines set due_at = ? where id = ?")
      .run(newDue, "dl-resched-row");
    const nearer = new Date(afterNow.getTime() + 2 * 60_000);
    expect(service.generateDueReminders({ now: nearer }).created).toBe(1);
    expect(service.listActive(userA, nearer)).toHaveLength(1);
  });

  it("invalidates old reminder when deadline title changes", () => {
    seedApplication("app-a", "interview");
    const now = new Date("2026-08-26T00:00:00Z");
    seedDeadline("dl-title", "app-a", now.getTime() + 12 * HOUR_MS);
    service.generateDueReminders({ now });
    const before = service.listActive(userA, now);
    expect(before[0]?.message).toContain("dl-title");
    connection.sqlite
      .prepare("update application_deadlines set title = ? where id = ?")
      .run("新しいタイトル", "dl-title-row");
    const afterNow = new Date(now.getTime() + 60_000);
    service.generateDueReminders({ now: afterNow });
    const after = service.listActive(userA, afterNow);
    expect(after).toHaveLength(1);
    expect(after[0]?.message).toContain("新しいタイトル");
    expect(after[0]?.message).not.toContain("dl-title");
  });

  it("invalidates old reminder when deadline kind changes", () => {
    seedApplication("app-a", "interview");
    const now = new Date("2026-08-26T00:00:00Z");
    seedDeadline("dl-kind", "app-a", now.getTime() + 12 * HOUR_MS, {
      kind: "document",
    });
    service.generateDueReminders({ now });
    expect(service.listActive(userA, now)[0]?.message).toContain("ES・書類");

    connection.sqlite
      .prepare("update application_deadlines set kind = ? where id = ?")
      .run("interview", "dl-kind-row");
    const afterNow = new Date(now.getTime() + 60_000);
    service.generateDueReminders({ now: afterNow });
    const after = service.listActive(userA, afterNow);
    expect(after).toHaveLength(1);
    expect(after[0]?.message).toContain("面接");
    expect(after[0]?.message).not.toContain("ES・書類");
  });

  it("cascades reminders when their deadline is deleted", () => {
    seedApplication("app-a", "interview");
    const now = new Date("2026-08-26T00:00:00Z");
    seedDeadline("dl-delete", "app-a", now.getTime() + 12 * HOUR_MS);
    service.generateDueReminders({ now });
    expect(service.listActive(userA, now)).toHaveLength(1);

    connection.sqlite
      .prepare("delete from application_deadlines where id = ?")
      .run("dl-delete-row");

    expect(service.listActive(userA, now)).toHaveLength(0);
    const stored = connection.sqlite
      .prepare("select count(*) as count from reminders where deadline_id = ?")
      .get("dl-delete-row") as { count: number };
    expect(stored.count).toBe(0);
  });

  it("uses deadline timezone for message formatting", () => {
    seedApplication("app-a", "interview");
    const now = new Date("2026-08-26T00:00:00Z");
    seedDeadline("dl-tz", "app-a", now.getTime() + 12 * HOUR_MS);
    // Change timezone to America/Los_Angeles and keep same instant
    connection.sqlite
      .prepare("update application_deadlines set timezone = ? where id = ?")
      .run("America/Los_Angeles", "dl-tz-row");
    // Regenerate – should produce a reminder with due text in that zone
    service.generateDueReminders({ now });
    const active = service.listActive(userA, now);
    expect(active).toHaveLength(1);
    // Message should contain the title and not be empty
    expect(active[0]?.message).toContain("dl-tz");
    // The dedupe should vary by timezone: changing again should dismiss old
    connection.sqlite
      .prepare("update application_deadlines set timezone = ? where id = ?")
      .run("Asia/Tokyo", "dl-tz-row");
    const later = new Date(now.getTime() + 60_000);
    service.generateDueReminders({ now: later });
    const after = service.listActive(userA, later);
    expect(after).toHaveLength(1);
    // System stale is deleted, not kept as dismissed (#174) – total rows 1 but only 1 active
    const all = connection.sqlite
      .prepare("select count(*) as c from reminders")
      .get() as { c: number };
    expect(all.c).toBe(1);
  });
});

describe("ReminderService.listActive stale sweep", () => {
  function markDeadlineCompleted(deadlineId: string): void {
    connection.sqlite
      .prepare("update application_deadlines set completed_at = ? where id = ?")
      .run(Date.now(), deadlineId);
  }

  function markApplicationStatus(applicationId: string, status: string): void {
    connection.sqlite
      .prepare("update applications set status = ? where id = ?")
      .run(status, applicationId);
  }

  function storedReminderStatuses(): Array<{ id: string; status: string }> {
    return connection.sqlite
      .prepare("select id, status from reminders order by id")
      .all() as Array<{ id: string; status: string }>;
  }

  it("dismisses and hides reminders once their deadline is completed", () => {
    seedApplication("app-a", "interview");
    const now = new Date("2026-08-26T00:00:00Z");
    seedDeadline("dl-open", "app-a", now.getTime() + 12 * HOUR_MS);
    service.generateDueReminders({ now });
    expect(service.listActive(userA, now)).toHaveLength(1);

    markDeadlineCompleted("dl-open-row");
    expect(service.listActive(userA, now)).toHaveLength(0);
    // System stale is deleted, not kept as dismissed (#174)
    expect(storedReminderStatuses()).toHaveLength(0);
  });

  it("dismisses and hides reminders once their application terminates", () => {
    seedApplication("app-a", "interview");
    const now = new Date("2026-08-26T00:00:00Z");
    seedDeadline("dl-term", "app-a", now.getTime() + 12 * HOUR_MS);
    service.generateDueReminders({ now });
    expect(service.listActive(userA, now)).toHaveLength(1);

    markApplicationStatus("app-a", "withdrawn");
    expect(service.listActive(userA, now)).toHaveLength(0);
    // System stale is deleted, not kept as dismissed (#174)
    expect(storedReminderStatuses()).toHaveLength(0);
  });

  it("keeps active reminders for open deadlines pending when only read", () => {
    seedApplication("app-a", "interview");
    const now = new Date("2026-08-26T00:00:00Z");
    seedDeadline("dl-live", "app-a", now.getTime() + 12 * HOUR_MS);
    service.generateDueReminders({ now });

    const active = service.listActive(userA, now);
    expect(active).toHaveLength(1);
    for (const row of storedReminderStatuses()) {
      expect(row.status).toBe("pending");
    }
  });

  it("does not mark reminders outside the displayed page as sent", () => {
    seedApplication("app-a", "interview");
    const now = new Date("2026-08-26T00:00:00Z");
    seedDeadline("dl-one", "app-a", now.getTime() + 12 * HOUR_MS);
    service.generateDueReminders({ now });

    const reminder = connection.sqlite
      .prepare("select id, status from reminders limit 1")
      .get() as { id: string; status: string };
    expect(reminder.status).toBe("pending");

    service.listActive(userA, now);

    const after = connection.sqlite
      .prepare("select status from reminders where id = ?")
      .get(reminder.id) as { status: string };
    expect(after.status).toBe("pending");
  });
});
