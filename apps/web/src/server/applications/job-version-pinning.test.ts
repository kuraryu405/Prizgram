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

const user = { id: "pin-user", loginId: "pin.user" };

let temporaryDirectory: string;
let connection: DatabaseConnection;
let service: ApplicationService;

function snapshotFor(company: string, role: string) {
  return jobSnapshotSchema.parse({
    company,
    role,
    employmentType: "internship",
    description: `${company} ${role} の求人票`,
    requirements: [{ id: "job:req:pin", text: "TypeScript" }],
    desiredSkills: [],
    cultureValues: [],
    difficulty: { level: "entry", evidenceRefs: ["job:req:pin"] },
    source: {
      kind: "user_provided" as const,
      name: "test",
      retrievedAt: "2026-08-27T00:00:00Z",
    },
  });
}

function insertVersion(
  id: string,
  version: number,
  company: string,
  role: string,
): void {
  connection.sqlite
    .prepare(
      "insert into job_versions (id, user_id, job_id, version, snapshot, content_hash) values (?, ?, 'job-pin', ?, ?, ?)",
    )
    .run(
      id,
      user.id,
      version,
      JSON.stringify(snapshotFor(company, role)),
      `hash-${version}`,
    );
}

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "prizgram-pin-"));
  connection = createDatabase(path.join(temporaryDirectory, "pin.sqlite"));
  migrateDatabase(connection, migrationsFolder);
  connection.sqlite.prepare("insert into users (id) values (?)").run(user.id);
  connection.sqlite
    .prepare("insert into jobs (id, user_id) values ('job-pin', ?)")
    .run(user.id);
  insertVersion("job-pin-v1", 1, "株式会社V1", "V1エンジニア");
  service = new ApplicationService(connection);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("Application JobVersion pinning", () => {
  it("keeps application detail pinned to v1 after v2 is added", () => {
    const first = service.createFromJob(user, { jobId: "job-pin" });
    expect(first.jobVersionId).toBe("job-pin-v1");

    insertVersion("job-pin-v2", 2, "株式会社V2", "V2エンジニア");

    const detail = service.getApplicationDetail(user.id, first.applicationId);
    expect(detail.jobVersionId).toBe("job-pin-v1");
    expect(detail.company).toBe("株式会社V1");
    expect(detail.role).toBe("V1エンジニア");
    expect(detail.appliedCompany).toBe("株式会社V1");
    expect(detail.appliedRole).toBe("V1エンジニア");
  });

  it("resolves separate attempts of the same job by their own pinned versions", () => {
    const first = service.createFromJob(user, { jobId: "job-pin" });
    connection.sqlite
      .prepare("update applications set status = 'cancelled' where id = ?")
      .run(first.applicationId);

    insertVersion("job-pin-v2", 2, "株式会社V2", "V2エンジニア");
    const second = service.createFromJob(user, { jobId: "job-pin" });
    connection.sqlite
      .prepare("update applications set status = 'cancelled' where id = ?")
      .run(second.applicationId);

    const attempts = service.listApplications(user.id, { status: "cancelled" });
    expect(attempts).toHaveLength(2);

    const byVersion = new Map(
      attempts.map((attempt) => [attempt.jobVersionId, attempt]),
    );
    expect(byVersion.get("job-pin-v1")).toMatchObject({
      company: "株式会社V1",
      role: "V1エンジニア",
    });
    expect(byVersion.get("job-pin-v2")).toMatchObject({
      company: "株式会社V2",
      role: "V2エンジニア",
    });
  });
});
