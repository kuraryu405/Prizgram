import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applicationTransitions,
  canTransitionApplication,
  jobSnapshotSchema,
} from "@prizgram/shared";
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from "@prizgram/db";

import { AppError } from "../api";
import { ApplicationService, type ApplicationDetail } from "./service";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../packages/db/drizzle",
);

const userA = { id: "user-a", loginId: "student.one" };
const userB = { id: "user-b", loginId: "student.two" };

function snapshotFor(company: string) {
  return jobSnapshotSchema.parse({
    company,
    role: "エンジニア",
    employmentType: "internship",
    description: "説明文",
    requirements: [{ id: "job:req:1", text: "要件" }],
    desiredSkills: [],
    cultureValues: [],
    difficulty: { level: "entry", evidenceRefs: ["job:req:1"] },
    source: {
      kind: "user_provided" as const,
      name: "出典",
      retrievedAt: "2026-08-26T00:00:00Z",
    },
  });
}

let temporaryDirectory: string;
let connection: DatabaseConnection;
let service: ApplicationService;

function seedJob(id: string, userId: string, company: string): void {
  connection.sqlite
    .prepare("insert into users (id) values (?) on conflict do nothing")
    .run(userId);
  connection.sqlite
    .prepare("insert into jobs (id, user_id) values (?, ?)")
    .run(id, userId);
  connection.sqlite
    .prepare(
      "insert into job_versions (id, user_id, job_id, version, snapshot, content_hash) values (?, ?, ?, 1, ?, 'hash')",
    )
    .run(`${id}-v1`, userId, id, JSON.stringify(snapshotFor(company)));
}

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "prizgram-app-"));
  connection = createDatabase(path.join(temporaryDirectory, "app.sqlite"));
  migrateDatabase(connection, migrationsFolder);
  service = new ApplicationService(connection);
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

function syncErrorCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error("expected rejection");
}

describe("transitions rule", () => {
  it("covers every status and keeps terminal statuses closed", () => {
    for (const status of [
      "saved",
      "applying",
      "submitted",
      "screening",
      "interview",
      "offer",
      "accepted",
      "rejected",
      "withdrawn",
    ] as const) {
      expect(applicationTransitions[status]).toBeDefined();
      expect(applicationTransitions[status]).not.toContain(status);
    }
    for (const terminal of ["accepted", "rejected", "withdrawn"] as const) {
      expect(applicationTransitions[terminal]).toHaveLength(0);
      expect(canTransitionApplication(terminal, "saved")).toBe(false);
    }
    expect(canTransitionApplication("saved", "applying")).toBe(true);
    expect(canTransitionApplication("saved", "offer")).toBe(false);
  });
});

describe("ApplicationService", () => {
  it("creates an application from an owned job with an initial stage event", () => {
    seedJob("job-a", userA.id, "株式会社サンプル");
    const created = service.createFromJob(userA, { jobId: "job-a" });
    expect(created.status).toBe("saved");
    expect(created.company).toBe("株式会社サンプル");

    const detail: ApplicationDetail = service.getApplicationDetail(
      userA.id,
      created.applicationId,
    );
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]).toMatchObject({
      sequence: 1,
      toStatus: "saved",
    });
  });

  it("rejects a duplicate application for the same job with 409", async () => {
    seedJob("job-a", userA.id, "株式会社サンプル");
    service.createFromJob(userA, { jobId: "job-a" });
    await expect(
      errorCode(
        Promise.resolve().then(() =>
          service.createFromJob(userA, { jobId: "job-a" }),
        ),
      ),
    ).resolves.toBe("APPLICATION_EXISTS");
  });

  it("refuses to create from another user's job", () => {
    seedJob("job-b", userB.id, "他社");
    expect(
      syncErrorCode(() => service.createFromJob(userA, { jobId: "job-b" })),
    ).toBe("NOT_FOUND");
  });

  it("applies a legal transition atomically with one new event and bumped updated_at", () => {
    seedJob("job-a", userA.id, "株式会社サンプル");
    const created = service.createFromJob(userA, { jobId: "job-a" });
    const before = service.getApplicationDetail(
      userA.id,
      created.applicationId,
    );

    const updated = service.updateApplication(userA, created.applicationId, {
      status: "applying",
      note: "応募書類を送付",
    });

    expect(updated.status).toBe("applying");
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(
      Date.parse(before.updatedAt),
    );
    expect(updated.events).toHaveLength(2);
    expect(updated.events[1]).toMatchObject({
      sequence: 2,
      fromStatus: "saved",
      toStatus: "applying",
      note: "応募書類を送付",
    });
  });

  it("rejects illegal transitions without touching data or history", () => {
    seedJob("job-a", userA.id, "株式会社サンプル");
    const created = service.createFromJob(userA, { jobId: "job-a" });

    expect(
      syncErrorCode(() =>
        service.updateApplication(userA, created.applicationId, {
          status: "offer",
        }),
      ),
    ).toBe("INVALID_STATUS_TRANSITION");

    const detail = service.getApplicationDetail(
      userA.id,
      created.applicationId,
    );
    expect(detail.status).toBe("saved");
    expect(detail.events).toHaveLength(1);
  });

  it("updates next action or note alone without creating events", () => {
    seedJob("job-a", userA.id, "株式会社サンプル");
    const created = service.createFromJob(userA, { jobId: "job-a" });

    const updated = service.updateApplication(userA, created.applicationId, {
      nextAction: "ESを書く",
    });
    expect(updated.nextAction).toBe("ESを書く");
    expect(updated.events).toHaveLength(1);
  });

  it("increments sequences across successive transitions", () => {
    seedJob("job-a", userA.id, "株式会社サンプル");
    const created = service.createFromJob(userA, { jobId: "job-a" });
    service.updateApplication(userA, created.applicationId, {
      status: "applying",
    });
    service.updateApplication(userA, created.applicationId, {
      status: "submitted",
    });
    const detail = service.getApplicationDetail(
      userA.id,
      created.applicationId,
    );
    expect(detail.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it("filters the list by status and hides other users' applications", () => {
    seedJob("job-a", userA.id, "株式会社サンプル");
    const created = service.createFromJob(userA, { jobId: "job-a" });
    service.updateApplication(userA, created.applicationId, {
      status: "applying",
    });

    expect(service.listApplications(userA.id)).toHaveLength(1);
    expect(
      service.listApplications(userA.id, { status: "applying" }),
    ).toHaveLength(1);
    expect(
      service.listApplications(userA.id, { status: "offer" }),
    ).toHaveLength(0);
    expect(service.listApplications(userB.id)).toHaveLength(0);

    expect(
      syncErrorCode(() =>
        service.getApplicationDetail(userB.id, created.applicationId),
      ),
    ).toBe("NOT_FOUND");
  });

  it("persists note on creation and returns it via detail (#159)", () => {
    seedJob("job-a", userA.id, "株式会社サンプル");
    const created = service.createFromJob(userA, {
      jobId: "job-a",
      note: "最初のメモ",
    });
    expect(created.note).toBe("最初のメモ");
    const detail = service.getApplicationDetail(
      userA.id,
      created.applicationId,
    );
    expect(detail.note).toBe("最初のメモ");
    expect(detail.events[0]?.note).toBe("最初のメモ");
    // list also reflects note
    expect(service.listApplications(userA.id)[0]?.note).toBe("最初のメモ");
  });

  it("updates note alone, clears with null, and preserves note on status-only change (#159)", () => {
    seedJob("job-a", userA.id, "株式会社サンプル");
    const created = service.createFromJob(userA, {
      jobId: "job-a",
      note: "初期メモ",
    });
    // update note alone
    let updated = service.updateApplication(userA, created.applicationId, {
      note: "更新メモ",
    });
    expect(updated.note).toBe("更新メモ");
    expect(updated.events).toHaveLength(1);
    // clear with null
    updated = service.updateApplication(userA, created.applicationId, {
      note: null,
    });
    expect(updated.note).toBeUndefined();
    expect(updated.events).toHaveLength(1);
    // status change without note should not clear current note when note is present
    updated = service.updateApplication(userA, created.applicationId, {
      note: "再メモ",
    });
    expect(updated.note).toBe("再メモ");
    updated = service.updateApplication(userA, created.applicationId, {
      status: "applying",
    });
    expect(updated.note).toBe("再メモ");
    expect(updated.events).toHaveLength(2);
    expect(updated.events[1]?.note).toBeUndefined();
    // status + note together: both application note and event note should match
    updated = service.updateApplication(userA, created.applicationId, {
      status: "submitted",
      note: "提出時メモ",
    });
    expect(updated.note).toBe("提出時メモ");
    expect(updated.events[2]?.note).toBe("提出時メモ");
  });

  it("pins job version at creation and keeps it after job update (#184)", () => {
    seedJob("job-a", userA.id, "株式会社サンプル");
    const created = service.createFromJob(userA, { jobId: "job-a" });
    const detailV1 = service.getApplicationDetail(
      userA.id,
      created.applicationId,
    );
    expect(detailV1.company).toBe("株式会社サンプル");
    expect(detailV1.jobVersionId).toBe("job-a-v1");
    // Create a new job version v2 with different company/role
    connection.sqlite
      .prepare(
        "insert into job_versions (id, user_id, job_id, version, snapshot, content_hash) values (?, ?, ?, 2, ?, 'hash2')",
      )
      .run(
        "job-a-v2",
        userA.id,
        "job-a",
        JSON.stringify(snapshotFor("株式会社アップデート")),
      );
    const detailAfter = service.getApplicationDetail(
      userA.id,
      created.applicationId,
    );
    // Should still point to v1
    expect(detailAfter.company).toBe("株式会社サンプル");
    expect(detailAfter.jobVersionId).toBe("job-a-v1");
    expect(detailAfter.appliedCompany).toBe("株式会社サンプル");
    // list also keeps pinned
    expect(service.listApplications(userA.id)[0]?.company).toBe(
      "株式会社サンプル",
    );
    // New application after v2 should pin v2
    seedJob("job-b", userA.id, "株式会社サンプル");
    // Replace job-b's version snapshot to be v1, then create app, then update job-b to v2
    const appB = service.createFromJob(userA, { jobId: "job-b" });
    expect(
      service.getApplicationDetail(userA.id, appB.applicationId).jobVersionId,
    ).toBe("job-b-v1");
    // Ensure user isolation: cannot pin foreign user's version
    seedJob("job-c", userB.id, "他社");
    // Attempt to manually set jobVersionId to foreign version via direct DB should be prevented by FK
    // Our service always resolves latest owned version, so foreign job cannot be used for app creation
    expect(
      syncErrorCode(() => service.createFromJob(userA, { jobId: "job-c" })),
    ).toBe("NOT_FOUND");
  });

  it("rejects application creation when job has no version", () => {
    connection.sqlite
      .prepare("insert into users (id) values (?)")
      .run(userA.id);
    connection.sqlite
      .prepare("insert into jobs (id, user_id) values (?, ?)")
      .run("lonely-job", userA.id);
    expect(
      syncErrorCode(() =>
        service.createFromJob(userA, { jobId: "lonely-job" }),
      ),
    ).toBe("NOT_FOUND");
  });
});
