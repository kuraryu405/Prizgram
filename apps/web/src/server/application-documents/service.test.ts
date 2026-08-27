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

import {
  ApplicationDocumentService,
  documentEntryCreateRequestSchema,
  documentUpdateRequestSchema,
} from "./service";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../packages/db/drizzle",
);

let temporaryDirectory: string;
let connection: DatabaseConnection;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "prizgram-doc-"));
  connection = createDatabase(path.join(temporaryDirectory, "doc.sqlite"));
  migrateDatabase(connection, migrationsFolder);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function createJobSnapshot() {
  return jobSnapshotSchema.parse({
    company: "Acme",
    role: "Engineer",
    employmentType: "full_time",
    description: "Desc",
    requirements: [{ id: "req:1", text: "Req" }],
    desiredSkills: [],
    cultureValues: [],
    difficulty: { level: "developing", evidenceRefs: ["req:1"] },
    source: {
      kind: "user_provided",
      name: "manual",
      retrievedAt: new Date().toISOString(),
    },
  });
}

function seedUserAndApplication(
  userId: string,
  applicationId: string,
  jobId: string,
) {
  connection.sqlite.prepare("insert into users (id) values (?)").run(userId);
  const snapshot = createJobSnapshot();
  const jobVersionId = `jv-${jobId}`;
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
      `hash-${jobId}`,
    );
  connection.sqlite
    .prepare(
      "insert into applications (id, user_id, job_id, job_version_id, status) values (?, ?, ?, ?, ?)",
    )
    .run(applicationId, userId, jobId, jobVersionId, "saved");
  connection.sqlite
    .prepare(
      "insert into application_stage_events (id, user_id, application_id, sequence, from_status, to_status, occurred_at) values (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      `ev-${applicationId}`,
      userId,
      applicationId,
      1,
      null,
      "saved",
      Date.now(),
    );
}

describe("ApplicationDocumentService (#125)", () => {
  it("creates a document under an owned application", () => {
    seedUserAndApplication("user-a", "app-1", "job-1");
    const svc = new ApplicationDocumentService(connection);
    const doc = svc.createDocument({ id: "user-a" } as never, "app-1", {
      title: "志望動機",
    });
    expect(doc.title).toBe("志望動機");
    expect(doc.status).toBe("draft");
    expect(doc.entries).toHaveLength(0);
  });

  it("creates multiple questions with ordering and characterLimit", () => {
    seedUserAndApplication("user-a", "app-1", "job-1");
    const svc = new ApplicationDocumentService(connection);
    const doc = svc.createDocument({ id: "user-a" } as never, "app-1", {
      title: "ES",
    });
    svc.createEntry("user-a", doc.id, {
      question: "Q1",
      answer: "A1",
      characterLimit: 400,
      ordering: 0,
    });
    svc.createEntry("user-a", doc.id, {
      question: "Q2",
      answer: "A2",
      ordering: 1,
    });
    const fetched = svc.getDocument("user-a", doc.id);
    expect(fetched.entries).toHaveLength(2);
    expect(fetched.entries[0]?.question).toBe("Q1");
    expect(fetched.entries[0]?.characterLimit).toBe(400);
    expect(fetched.entries[1]?.question).toBe("Q2");
  });

  it("edits a document and distinguishes generated vs edited provenance", () => {
    seedUserAndApplication("user-a", "app-1", "job-1");
    const svc = new ApplicationDocumentService(connection);
    const doc = svc.createDocument({ id: "user-a" } as never, "app-1", {
      title: "ES",
    });
    const generated = svc.createEntry("user-a", doc.id, {
      question: "Q",
      answer: "AI draft",
      provenance: "generated",
    });
    expect(generated.provenance).toBe("generated");
    expect(svc.getDocument("user-a", doc.id).status).toBe("generated");

    const edited = svc.updateEntry("user-a", generated.id, {
      answer: "My edited answer",
    });
    expect(edited.provenance).toBe("edited");
    expect(svc.getDocument("user-a", doc.id).status).toBe("edited");
  });

  it("preserves submitted snapshot and disallows overwrite", () => {
    seedUserAndApplication("user-a", "app-1", "job-1");
    const svc = new ApplicationDocumentService(connection);
    const doc = svc.createDocument({ id: "user-a" } as never, "app-1", {
      title: "ES",
    });
    const entry = svc.createEntry("user-a", doc.id, {
      question: "Q",
      answer: "Final answer",
    });
    const submitted = svc.submitDocument("user-a", doc.id);
    expect(submitted.status).toBe("submitted");
    expect(submitted.submittedAt).not.toBeNull();
    expect(submitted.entries[0]?.provenance).toBe("edited");

    expect(() =>
      svc.updateDocument("user-a", doc.id, { title: "New" }),
    ).toThrow();
    expect(() =>
      svc.createEntry("user-a", doc.id, { question: "Q2", answer: "x" }),
    ).toThrow();
    expect(() =>
      svc.updateEntry("user-a", entry.id, { answer: "overwrite" }),
    ).toThrow();
    expect(() => svc.deleteEntry("user-a", entry.id)).toThrow();

    const still = svc.getDocument("user-a", doc.id);
    expect(still.entries[0]?.answer).toBe("Final answer");
  });

  it("keeps generated/edited provenance after submission", () => {
    seedUserAndApplication("user-a", "app-1", "job-1");
    const svc = new ApplicationDocumentService(connection);
    const doc = svc.createDocument({ id: "user-a" } as never, "app-1", {
      title: "ES",
    });
    svc.createEntry("user-a", doc.id, {
      question: "Q1",
      answer: "Generated draft",
      provenance: "generated",
    });
    svc.createEntry("user-a", doc.id, {
      question: "Q2",
      answer: "Edited by user",
      provenance: "edited",
    });

    svc.submitDocument("user-a", doc.id);
    const submitted = svc.getDocument("user-a", doc.id);
    expect(submitted.status).toBe("submitted");
    expect(submitted.entries[0]?.provenance).toBe("generated");
    expect(submitted.entries[1]?.provenance).toBe("edited");
  });

  it("does not accept submitted state through generic write schemas", () => {
    expect(
      documentEntryCreateRequestSchema.safeParse({
        question: "Q",
        provenance: "submitted",
      }).success,
    ).toBe(false);
    expect(
      documentUpdateRequestSchema.safeParse({
        title: "ES",
        submittedAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
    expect(
      documentUpdateRequestSchema.safeParse({
        title: "ES",
        status: "submitted",
      }).success,
    ).toBe(false);
  });

  it("denies cross-user access via application ownership", () => {
    seedUserAndApplication("user-a", "app-1", "job-1");
    connection.sqlite
      .prepare("insert into users (id) values (?)")
      .run("user-b");
    const svc = new ApplicationDocumentService(connection);
    const doc = svc.createDocument({ id: "user-a" } as never, "app-1", {
      title: "ES",
    });
    expect(() => svc.getDocument("user-b", doc.id)).toThrow();
    expect(() =>
      svc.createEntry("user-b", doc.id, { question: "Q", answer: "x" }),
    ).toThrow();
    expect(() => svc.listDocuments("user-b", "app-1")).toThrow();
    expect(() =>
      svc.updateDocument("user-b", doc.id, { title: "Hack" }),
    ).toThrow();
  });

  it("cascades on application deletion (via FK)", () => {
    seedUserAndApplication("user-a", "app-1", "job-1");
    const svc = new ApplicationDocumentService(connection);
    const doc = svc.createDocument({ id: "user-a" } as never, "app-1", {
      title: "ES",
    });
    svc.createEntry("user-a", doc.id, { question: "Q", answer: "A" });
    connection.sqlite
      .prepare("delete from applications where id = ?")
      .run("app-1");
    const remaining = connection.sqlite
      .prepare("select count(*) as c from application_documents where id = ?")
      .get(doc.id) as { c: number };
    expect(remaining.c).toBe(0);
  });

  it("handles ordering and characterLimit correctly", () => {
    seedUserAndApplication("user-a", "app-1", "job-1");
    const svc = new ApplicationDocumentService(connection);
    const doc = svc.createDocument({ id: "user-a" } as never, "app-1", {
      title: "ES",
    });
    svc.createEntry("user-a", doc.id, { question: "Q2", ordering: 2 });
    svc.createEntry("user-a", doc.id, { question: "Q1", ordering: 1 });
    const fetched = svc.getDocument("user-a", doc.id);
    expect(fetched.entries[0]?.question).toBe("Q1");
    expect(fetched.entries[1]?.question).toBe("Q2");
  });

  it("lists documents per application", () => {
    seedUserAndApplication("user-a", "app-1", "job-1");
    const svc = new ApplicationDocumentService(connection);
    svc.createDocument({ id: "user-a" } as never, "app-1", { title: "Doc1" });
    svc.createDocument({ id: "user-a" } as never, "app-1", { title: "Doc2" });
    const list = svc.listDocuments("user-a", "app-1");
    expect(list).toHaveLength(2);
  });
});
