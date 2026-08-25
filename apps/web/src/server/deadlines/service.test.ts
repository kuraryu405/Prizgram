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

import { AppError } from "../api";
import { DeadlineService, zonedDateTimeToIso } from "./service";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../packages/db/drizzle",
);

const userA = { id: "user-a", loginId: "student.one" };
const userB = { id: "user-b", loginId: "student.two" };

let temporaryDirectory: string;
let connection: DatabaseConnection;
let service: DeadlineService;
let applicationId: string;

function syncErrorCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error("expected rejection");
}

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "prizgram-dl-"));
  connection = createDatabase(path.join(temporaryDirectory, "dl.sqlite"));
  migrateDatabase(connection, migrationsFolder);
  connection.sqlite
    .prepare("insert into users (id) values (?), (?)")
    .run(userA.id, userB.id);
  connection.sqlite
    .prepare("insert into jobs (id, user_id) values (?, ?)")
    .run("job-a", userA.id);
  connection.sqlite
    .prepare("insert into applications (id, user_id, job_id) values (?, ?, ?)")
    .run("app-a", userA.id, "job-a");
  applicationId = "app-a";
  service = new DeadlineService(connection);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("zonedDateTimeToIso", () => {
  it("converts Tokyo wall time to the correct UTC instant", () => {
    expect(zonedDateTimeToIso("2026-08-26T18:00", "Asia/Tokyo")).toBe(
      "2026-08-26T09:00:00.000Z",
    );
  });

  it("handles DST boundaries in offset-heavy zones", () => {
    // PST (UTC-8) in winter
    expect(zonedDateTimeToIso("2026-01-15T12:00", "America/Los_Angeles")).toBe(
      "2026-01-15T20:00:00.000Z",
    );
    // PDT (UTC-7) in summer
    expect(zonedDateTimeToIso("2026-07-15T12:00", "America/Los_Angeles")).toBe(
      "2026-07-15T19:00:00.000Z",
    );
  });
});

describe("DeadlineService", () => {
  it("creates a deadline with a UTC instant and lists it ordered by due time", () => {
    const later = service.create(userA, {
      applicationId,
      kind: "interview",
      title: "1次面接",
      dueLocal: "2026-09-01T10:00",
      timeZone: "Asia/Tokyo",
    });
    const sooner = service.create(userA, {
      applicationId,
      kind: "document",
      title: "ES提出",
      dueLocal: "2026-08-28T23:59",
      timeZone: "Asia/Tokyo",
    });

    const list = service.list(userA.id);
    expect(list.map((deadline) => deadline.title)).toEqual([
      "ES提出",
      "1次面接",
    ]);
    expect(sooner.dueAt).toBe("2026-08-28T14:59:00.000Z");
    expect(later.timeZone).toBe("Asia/Tokyo");
    expect(sooner.completed).toBe(false);
  });

  it("marks overdue and within24Hours flags relative to now", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-26T00:00:00Z"));
      service.create(userA, {
        applicationId,
        kind: "document",
        title: "過去の締切",
        dueLocal: "2026-08-25T23:00",
        timeZone: "UTC",
      });
      const soon = service.create(userA, {
        applicationId,
        kind: "offer_response",
        title: "内定承諾",
        dueLocal: "2026-08-26T12:00",
        timeZone: "UTC",
      });
      const list = service.list(userA.id);
      const byTitle = new Map(list.map((d) => [d.title, d]));
      expect(byTitle.get("過去の締切")?.overdue).toBe(true);
      expect(byTitle.get("内定承諾")?.within24Hours).toBe(true);
      expect(soon.overdue).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("completes and reopens a deadline, updating updated_at", () => {
    const created = service.create(userA, {
      applicationId,
      kind: "document",
      title: "ES提出",
      dueLocal: "2026-08-30T12:00",
      timeZone: "UTC",
    });
    const completed = service.update(userA, created.deadlineId, {
      completed: true,
    });
    expect(completed.completed).toBe(true);
    const reopened = service.update(userA, created.deadlineId, {
      completed: false,
      title: "ES提出（修正）",
    });
    expect(reopened.completed).toBe(false);
    expect(reopened.title).toBe("ES提出（修正）");
    expect(Date.parse(reopened.dueAt)).toBe(Date.parse(created.dueAt));
  });

  it("edits due date across time zones keeping UTC storage", () => {
    const created = service.create(userA, {
      applicationId,
      kind: "interview",
      title: "面接",
      dueLocal: "2026-09-01T09:00",
      timeZone: "Asia/Tokyo",
    });
    const moved = service.update(userA, created.deadlineId, {
      dueLocal: "2026-09-01T09:00",
      timeZone: "America/Los_Angeles",
    });
    expect(moved.dueAt).toBe("2026-09-01T16:00:00.000Z");
  });

  it("deletes only owned deadlines", () => {
    const created = service.create(userA, {
      applicationId,
      kind: "other",
      title: "説明会",
      dueLocal: "2026-09-05T10:00",
      timeZone: "UTC",
    });
    expect(() => service.remove(userB, created.deadlineId)).toThrow(AppError);
    service.remove(userA, created.deadlineId);
    expect(service.list(userA.id)).toHaveLength(0);
    expect(
      syncErrorCode(() =>
        service.update(userA, created.deadlineId, { completed: true }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("keeps users isolated on create/list/update", () => {
    expect(
      syncErrorCode(() =>
        service.create(userB, {
          applicationId,
          kind: "document",
          title: "他人の締切",
          dueLocal: "2026-09-01T10:00",
          timeZone: "UTC",
        }),
      ),
    ).toBe("NOT_FOUND");
    const created = service.create(userA, {
      applicationId,
      kind: "document",
      title: "自分の締切",
      dueLocal: "2026-09-01T10:00",
      timeZone: "UTC",
    });
    expect(service.list(userB.id)).toHaveLength(0);
    expect(
      syncErrorCode(() =>
        service.update(userB, created.deadlineId, { title: "乗っ取り" }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("rejects unknown time zones and malformed local datetimes at the boundary", () => {
    expect(
      syncErrorCode(() =>
        service.create(userA, {
          applicationId,
          kind: "document",
          title: "壊れたTZ",
          dueLocal: "2026-09-01T10:00",
          timeZone: "Mars/Olympus",
        }),
      ),
    ).toBe("VALIDATION_ERROR");
    expect(
      syncErrorCode(() =>
        service.create(userA, {
          applicationId,
          kind: "document",
          title: "壊れた日時",
          dueLocal: "2026-09-01 10:00",
          timeZone: "UTC",
        }),
      ),
    ).toBe("VALIDATION_ERROR");
  });
});
