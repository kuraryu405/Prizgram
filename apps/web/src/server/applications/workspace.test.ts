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
import { jobSnapshotSchema } from "@prizgram/shared";

import { ApplicationService } from "./service";
import { DeadlineService } from "../deadlines/service";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../packages/db/drizzle",
);

let temporaryDirectory: string;
let connection: DatabaseConnection;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "prizgram-workspace-"),
  );
  connection = createDatabase(
    path.join(temporaryDirectory, "workspace.sqlite"),
  );
  migrateDatabase(connection, migrationsFolder);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function createJobSnapshot(
  overrides: Partial<ReturnType<typeof jobSnapshotSchema.parse>> = {},
) {
  return jobSnapshotSchema.parse({
    company: "Acme Corp",
    role: "Frontend Engineer",
    employmentType: "full_time",
    description: "Build web apps with React and TypeScript.",
    requirements: [{ id: "req:1", text: "React experience" }],
    desiredSkills: [{ id: "skill:1", text: "TypeScript" }],
    cultureValues: [{ id: "cult:1", text: "Ownership" }],
    difficulty: { level: "developing", evidenceRefs: ["req:1"] },
    source: {
      kind: "user_provided",
      name: "manual",
      retrievedAt: new Date().toISOString(),
    },
    ...overrides,
  });
}

function seedUser(userId: string) {
  connection.sqlite.prepare("insert into users (id) values (?)").run(userId);
}

function createJobForUser(
  userId: string,
  jobId: string,
  snapshotOverrides: Parameters<typeof createJobSnapshot>[0] = {},
) {
  const snapshot = createJobSnapshot(snapshotOverrides);
  const jobVersionId = `jv-${jobId}-1`;
  connection.sqlite
    .prepare("insert into jobs (id, user_id) values (?, ?)")
    .run(jobId, userId);
  connection.sqlite
    .prepare(
      "insert into job_versions (id, user_id, job_id, version, snapshot, content_hash) values (?, ?, ?, ?, ?, ?)",
    )
    .run(
      jobVersionId,
      userId,
      jobId,
      1,
      JSON.stringify(snapshot),
      `hash-${jobId}-1`,
    );
  return { jobId, jobVersionId, snapshot };
}

describe("Application workspace (#262)", () => {
  it("creates application from job with pinned JobVersion", () => {
    const userId = "user-a";
    seedUser(userId);
    const { jobId, jobVersionId } = createJobForUser(userId, "job-1");
    const svc = new ApplicationService(connection);
    const created = svc.createFromJob({ id: userId } as never, { jobId });
    expect(created.jobVersionId).toBe(jobVersionId);
    expect(created.company).toBe("Acme Corp");
    expect(created.role).toBe("Frontend Engineer");

    // Update job to new version, ensure pinned does not change
    const newSnapshot = createJobSnapshot({
      company: "Acme Corp",
      role: "Backend Engineer",
    });
    const newVersionId = `jv-${jobId}-2`;
    connection.sqlite
      .prepare(
        "insert into job_versions (id, user_id, job_id, version, snapshot, content_hash) values (?, ?, ?, ?, ?, ?)",
      )
      .run(
        newVersionId,
        userId,
        jobId,
        2,
        JSON.stringify(newSnapshot),
        `hash-${jobId}-2`,
      );

    const detail = svc.getApplicationDetail(userId, created.applicationId);
    expect(detail.jobVersionId).toBe(jobVersionId);
    expect(detail.appliedCompany).toBe("Acme Corp");
    expect(detail.appliedRole).toBe("Frontend Engineer");
    // current latest would be Backend, but applied stays Frontend
    expect(detail.company).toBe("Acme Corp");
    expect(detail.role).toBe("Frontend Engineer");
  });

  it("exposes Job -> Application one-click without re-entering company/role", () => {
    const userId = "user-a";
    seedUser(userId);
    const { jobId } = createJobForUser(userId, "job-1", {
      company: "JobCo",
      role: "Designer",
    });
    const svc = new ApplicationService(connection);
    const created = svc.createFromJob({ id: userId } as never, { jobId });
    // company/role are derived from pinned snapshot, not re-entered
    expect(created.company).toBe("JobCo");
    expect(created.role).toBe("Designer");
    // findApplicationForJob returns same
    const found = svc.findApplicationForJob(userId, jobId);
    expect(found?.applicationId).toBe(created.applicationId);
  });

  it("shows workspace detail with history and nextAction", () => {
    const userId = "user-a";
    seedUser(userId);
    const { jobId } = createJobForUser(userId, "job-1");
    const svc = new ApplicationService(connection);
    const created = svc.createFromJob({ id: userId } as never, {
      jobId,
      nextAction: "ESを書く",
      stageLabel: "書類選考",
    });
    const detail = svc.getApplicationDetail(userId, created.applicationId);
    expect(detail.nextAction).toBe("ESを書く");
    expect(detail.stageLabel).toBe("書類選考");
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]?.toStatus).toBe("saved");
  });

  it("aggregates deadlines per application without duplicating source of truth", () => {
    const userId = "user-a";
    seedUser(userId);
    const { jobId } = createJobForUser(userId, "job-1");
    const appSvc = new ApplicationService(connection);
    const created = appSvc.createFromJob({ id: userId } as never, { jobId });
    const deadlineSvc = new DeadlineService(connection);
    const dueLocal = "2026-09-10T10:00";
    const createdDeadline = deadlineSvc.create({ id: userId } as never, {
      applicationId: created.applicationId,
      kind: "document",
      title: "ES提出",
      dueLocal,
      timeZone: "Asia/Tokyo",
    });
    const list = deadlineSvc.listForApplication(userId, created.applicationId);
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe("ES提出");
    expect(createdDeadline.applicationId).toBe(created.applicationId);
    // Ensure Application.nextAction remains separate from Deadline
    const detail = appSvc.getApplicationDetail(userId, created.applicationId);
    expect(detail.nextAction).toBeUndefined();
  });

  it("denies cross-user access to application detail and job application", () => {
    const userA = "user-a";
    const userB = "user-b";
    seedUser(userA);
    seedUser(userB);
    const { jobId } = createJobForUser(userA, "job-1");
    const svc = new ApplicationService(connection);
    const created = svc.createFromJob({ id: userA } as never, { jobId });
    expect(() =>
      svc.getApplicationDetail(userB, created.applicationId),
    ).toThrow();
    expect(() =>
      svc.createFromJob({ id: userB } as never, { jobId }),
    ).toThrow();
    expect(svc.findApplicationForJob(userB, jobId)).toBeUndefined();
  });

  it("preserves stage history as append-only source of truth", () => {
    const userId = "user-a";
    seedUser(userId);
    const { jobId } = createJobForUser(userId, "job-1");
    const svc = new ApplicationService(connection);
    const created = svc.createFromJob({ id: userId } as never, { jobId });
    svc.updateApplication({ id: userId } as never, created.applicationId, {
      status: "applying",
      stageLabel: "書類提出",
    });
    const detail = svc.getApplicationDetail(userId, created.applicationId);
    expect(detail.status).toBe("applying");
    expect(detail.stageLabel).toBe("書類提出");
    expect(detail.events).toHaveLength(2);
    expect(detail.events[1]?.fromStatus).toBe("saved");
    expect(detail.events[1]?.toStatus).toBe("applying");
  });

  it("findApplicationForJob returns undefined after cancellation", () => {
    const userId = "user-a";
    seedUser(userId);
    const { jobId } = createJobForUser(userId, "job-1");
    const svc = new ApplicationService(connection);
    const created = svc.createFromJob({ id: userId } as never, { jobId });
    svc.updateApplication({ id: userId } as never, created.applicationId, {
      status: "cancelled",
    });
    expect(svc.findApplicationForJob(userId, jobId)).toBeUndefined();
  });
});
