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
  connection.sqlite.prepare("insert into users (id) values (?)").run(userId);
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
  it("creates an application with an initial status and stage label", () => {
    seedJob("job-a", userA.id, "株式会社サンプル");
    const created = service.createFromJob(userA, {
      jobId: "job-a",
      status: "applying",
      stageLabel: "書類選考中",
    });
    expect(created.status).toBe("applying");
    expect(created.stageLabel).toBe("書類選考中");
    expect(created.company).toBe("株式会社サンプル");

    const detail: ApplicationDetail = service.getApplicationDetail(
      userA.id,
      created.applicationId,
    );
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]).toMatchObject({
      sequence: 1,
      toStatus: "applying",
      stageLabel: "書類選考中",
    });
  });

  it("records stage-label changes and corrections in selection history", () => {
    seedJob("job-a", userA.id, "株式会社サンプル");
    const created = service.createFromJob(userA, { jobId: "job-a" });

    const labeled = service.updateApplication(userA, created.applicationId, {
      stageLabel: "1次面接",
    });
    expect(labeled.stageLabel).toBe("1次面接");
    expect(labeled.events).toHaveLength(2);
    expect(labeled.events[1]).toMatchObject({
      sequence: 2,
      fromStatus: "saved",
      toStatus: "saved",
      stageLabel: "1次面接",
    });

    const relabeled = service.updateApplication(userA, created.applicationId, {
      stageLabel: "2次面接",
    });
    expect(relabeled.events).toHaveLength(3);
    expect(relabeled.events[2]).toMatchObject({
      sequence: 3,
      fromStatus: "saved",
      toStatus: "saved",
      stageLabel: "2次面接",
    });

    const transitioned = service.updateApplication(
      userA,
      created.applicationId,
      { status: "applying" },
    );
    expect(transitioned.events).toHaveLength(4);
    expect(transitioned.events[3]).toMatchObject({
      sequence: 4,
      fromStatus: "saved",
      toStatus: "applying",
      stageLabel: "2次面接",
    });

    const cleared = service.updateApplication(userA, created.applicationId, {
      stageLabel: null,
    });
    expect(cleared.stageLabel).toBeUndefined();
    expect(cleared.events).toHaveLength(5);
    expect(cleared.events[4]).toMatchObject({
      sequence: 5,
      fromStatus: "applying",
      toStatus: "applying",
    });
    expect(cleared.events[4]?.stageLabel).toBeUndefined();
  });

  it("allows correcting a non-terminal broad status backwards", () => {
    seedJob("job-a", userA.id, "株式会社サンプル");
    const created = service.createFromJob(userA, {
      jobId: "job-a",
      status: "interview",
      stageLabel: "1次面接",
    });

    const corrected = service.updateApplication(userA, created.applicationId, {
      status: "screening",
      stageLabel: "Webテスト",
    });

    expect(corrected.status).toBe("screening");
    expect(corrected.stageLabel).toBe("Webテスト");
    expect(corrected.events[1]).toMatchObject({
      sequence: 2,
      fromStatus: "interview",
      toStatus: "screening",
      stageLabel: "Webテスト",
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

  it("rejects illegal terminal transitions without touching data or history", () => {
    seedJob("job-a", userA.id, "株式会社サンプル");
    const created = service.createFromJob(userA, { jobId: "job-a" });

    expect(
      syncErrorCode(() =>
        service.updateApplication(userA, created.applicationId, {
          status: "accepted",
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
});
