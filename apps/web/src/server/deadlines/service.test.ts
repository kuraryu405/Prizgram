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

  it("rejects nonexistent local times in DST gaps", () => {
    // 2026-03-08 is spring-forward in America/Los_Angeles: 02:00-03:00 does not exist
    expect(
      syncErrorCode(() =>
        zonedDateTimeToIso("2026-03-08T02:30", "America/Los_Angeles"),
      ),
    ).toBe("VALIDATION_ERROR");
  });

  it("handles ambiguous fall-back times deterministically (earlier occurrence)", () => {
    // 2026-11-01 is fall-back: 01:30 occurs twice. Should not throw and should map to first occurrence.
    const iso = zonedDateTimeToIso("2026-11-01T01:30", "America/Los_Angeles");
    // Earlier occurrence is PDT (UTC-7) => 08:30 UTC
    expect(iso).toBe("2026-11-01T08:30:00.000Z");
    // Round-trip should reproduce the same wall time
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(iso));
    const map: Record<string, string> = {};
    for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
    const wall = `${map.year}-${map.month}-${map.day}T${String(Number(map.hour) % 24).padStart(2, "0")}:${map.minute}`;
    expect(wall).toBe("2026-11-01T01:30");
  });

  it("round-trips normal times through the selected timezone", () => {
    const cases: Array<[string, string]> = [
      ["2026-08-26T18:00", "Asia/Tokyo"],
      ["2026-06-01T09:00", "UTC"],
      ["2026-12-15T14:30", "America/New_York"],
    ];
    for (const [local, tz] of cases) {
      const iso = zonedDateTimeToIso(local, tz);
      // Converting back should reproduce the original wall time
      const wall = (() => {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hour12: false,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).formatToParts(new Date(iso));
        const m: Record<string, string> = {};
        for (const p of parts) if (p.type !== "literal") m[p.type] = p.value;
        const h = String(Number(m.hour) % 24).padStart(2, "0");
        return `${m.year}-${m.month}-${m.day}T${h}:${m.minute}`;
      })();
      expect(wall).toBe(local);
    }
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
      requestId: "request-later",
    });
    const sooner = service.create(userA, {
      applicationId,
      kind: "document",
      title: "ES提出",
      dueLocal: "2026-08-28T23:59",
      timeZone: "Asia/Tokyo",
      requestId: "request-sooner",
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

  it("returns the existing deadline when a create request is replayed", () => {
    const first = service.create(userA, {
      applicationId,
      kind: "document",
      title: "ES提出",
      dueLocal: "2026-08-28T10:00",
      timeZone: "Asia/Tokyo",
      requestId: "request-replay",
    });
    const replayed = service.create(userA, {
      applicationId,
      kind: "interview",
      title: "変更されない面接",
      dueLocal: "2026-09-01T10:00",
      timeZone: "UTC",
      requestId: "request-replay",
    });

    expect(replayed).toEqual(first);
    expect(service.list(userA.id)).toHaveLength(1);
  });

  it("scopes request ids to the authenticated user", () => {
    connection.sqlite
      .prepare("insert into jobs (id, user_id) values (?, ?)")
      .run("job-b", userB.id);
    connection.sqlite
      .prepare(
        "insert into applications (id, user_id, job_id) values (?, ?, ?)",
      )
      .run("app-b", userB.id, "job-b");

    const first = service.create(userA, {
      applicationId,
      kind: "document",
      title: "自分のES",
      dueLocal: "2026-08-28T10:00",
      timeZone: "UTC",
      requestId: "request-shared",
    });
    const otherUser = service.create(userB, {
      applicationId: "app-b",
      kind: "document",
      title: "他人のES",
      dueLocal: "2026-08-28T10:00",
      timeZone: "UTC",
      requestId: "request-shared",
    });

    expect(otherUser.deadlineId).not.toBe(first.deadlineId);
    expect(service.list(userA.id)).toHaveLength(1);
    expect(service.list(userB.id)).toHaveLength(1);
  });

  it.each(["accepted", "rejected", "withdrawn"])(
    "rejects new deadlines for terminal application status %s",
    (status) => {
      connection.sqlite
        .prepare("update applications set status = ? where id = ?")
        .run(status, applicationId);

      expect(
        syncErrorCode(() =>
          service.create(userA, {
            applicationId,
            kind: "document",
            title: "作成されない締切",
            dueLocal: "2026-09-01T10:00",
            timeZone: "UTC",
            requestId: "request-terminal",
          }),
        ),
      ).toBe("APPLICATION_TERMINAL");
      expect(service.list(userA.id)).toHaveLength(0);
    },
  );

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
        requestId: "request-overdue",
      });
      const soon = service.create(userA, {
        applicationId,
        kind: "offer_response",
        title: "内定承諾",
        dueLocal: "2026-08-26T12:00",
        timeZone: "UTC",
        requestId: "request-soon",
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
      requestId: "request-complete",
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
      requestId: "request-move",
    });
    const moved = service.update(userA, created.deadlineId, {
      dueLocal: "2026-09-01T09:00",
      timeZone: "America/Los_Angeles",
    });
    expect(moved.dueAt).toBe("2026-09-01T16:00:00.000Z");
  });

  it("rejects a time zone-only update", () => {
    const created = service.create(userA, {
      applicationId,
      kind: "interview",
      title: "面接",
      dueLocal: "2026-09-01T09:00",
      timeZone: "Asia/Tokyo",
      requestId: "request-zone-only",
    });

    expect(
      syncErrorCode(() =>
        service.update(userA, created.deadlineId, {
          timeZone: "America/Los_Angeles",
        }),
      ),
    ).toBe("VALIDATION_ERROR");
    expect(service.list(userA.id)[0]?.dueAt).toBe(created.dueAt);
  });

  it("edits all browser-editable deadline fields in one update", () => {
    const created = service.create(userA, {
      applicationId,
      kind: "document",
      title: "ES提出",
      dueLocal: "2026-09-01T09:00",
      timeZone: "Asia/Tokyo",
      requestId: "request-edit",
    });
    const updated = service.update(userA, created.deadlineId, {
      kind: "interview",
      title: "一次面接",
      dueLocal: "2026-09-02T14:30",
      timeZone: "America/Los_Angeles",
    });

    expect(updated).toMatchObject({
      kind: "interview",
      title: "一次面接",
      timeZone: "America/Los_Angeles",
      dueAt: "2026-09-02T21:30:00.000Z",
    });
  });

  it("deletes only owned deadlines", () => {
    const created = service.create(userA, {
      applicationId,
      kind: "other",
      title: "説明会",
      dueLocal: "2026-09-05T10:00",
      timeZone: "UTC",
      requestId: "request-delete",
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
          requestId: "request-other-user",
        }),
      ),
    ).toBe("NOT_FOUND");
    const created = service.create(userA, {
      applicationId,
      kind: "document",
      title: "自分の締切",
      dueLocal: "2026-09-01T10:00",
      timeZone: "UTC",
      requestId: "request-owned",
    });
    expect(service.list(userB.id)).toHaveLength(0);
    expect(
      syncErrorCode(() =>
        service.update(userB, created.deadlineId, {
          kind: "interview",
          title: "乗っ取り",
        }),
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
          requestId: "request-invalid-tz",
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
          requestId: "request-invalid-date",
        }),
      ),
    ).toBe("VALIDATION_ERROR");
  });
});
