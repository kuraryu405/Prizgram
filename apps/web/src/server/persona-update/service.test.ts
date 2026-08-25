import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabase,
  migrateDatabase,
  personaVersions,
  type DatabaseConnection,
} from "@prizgram/db";
import { personaSnapshotSchema, type PersonaSnapshot } from "@prizgram/shared";

import { AppError } from "../api";
import { PersonaUpdateService } from "./service";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../packages/db/drizzle",
);

const userA = { id: "user-a", loginId: "student.one" };
const userB = { id: "user-b", loginId: "student.two" };

function baseSnapshot() {
  return personaSnapshotSchema.parse({
    skills: [],
    strengths: [],
    weaknesses: [],
    values: ["透明性"],
    preferences: { roles: [], industries: [], workStyles: [], locations: [] },
    experiences: [],
    evidence: [
      {
        id: "ev-base",
        sourceType: "user_input" as const,
        summary: "初回ヒアリングの回答",
      },
    ],
    confidence: 0.5,
  });
}

function proposedSnapshot(
  extraEvidence: Array<{
    id: string;
    sourceType: "application_event" | "user_input";
    sourceId: string;
    summary: string;
  }> = [],
): PersonaSnapshot {
  const base = baseSnapshot();
  return {
    ...base,
    strengths: ["データ基盤への興味が明確化"],
    evidence: [
      ...base.evidence.map((evidence) => ({ ...evidence })),
      ...extraEvidence,
    ],
    confidence: 0.8,
  };
}

let temporaryDirectory: string;
let connection: DatabaseConnection;
let service: PersonaUpdateService;

function seedBaseAndApplication(): {
  personaVersionId: string;
  applicationId: string;
} {
  connection.sqlite
    .prepare("insert into users (id) values (?), (?)")
    .run(userA.id, userB.id);
  connection.sqlite
    .prepare("insert into jobs (id, user_id) values ('job-a', ?)")
    .run(userA.id);
  connection.sqlite
    .prepare(
      "insert into applications (id, user_id, job_id, status) values ('app-a', ?, 'job-a', 'interview')",
    )
    .run(userA.id);
  connection.sqlite
    .prepare(
      'insert into persona_versions (id, user_id, version, snapshot, provenance) values (\'persona-base\', ?, 1, ?, \'{"source":"llm","sourceIds":[],"generatedAt":"2026-08-26T00:00:00Z"}\')',
    )
    .run(userA.id, JSON.stringify(baseSnapshot()));
  // Two real stage events for the application.
  connection.sqlite
    .prepare(
      "insert into application_stage_events (id, user_id, application_id, sequence, from_status, to_status, occurred_at) values ('evt-1', ?, 'app-a', 1, 'saved', 'applying', strftime('%s','now')*1000)",
    )
    .run(userA.id);
  connection.sqlite
    .prepare(
      "insert into application_stage_events (id, user_id, application_id, sequence, from_status, to_status, note, occurred_at) values ('evt-2', ?, 'app-a', 2, 'applying', 'submitted', '面接でデータ基盤に興味を示された', strftime('%s','now')*1000)",
    )
    .run(userA.id);
  return { personaVersionId: "persona-base", applicationId: "app-a" };
}

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "prizgram-pu-"));
  connection = createDatabase(path.join(temporaryDirectory, "pu.sqlite"));
  migrateDatabase(connection, migrationsFolder);
  service = new PersonaUpdateService(connection);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("PersonaUpdateService", () => {
  it("approves a proposal whose event evidence cites real stage events", () => {
    const ids = seedBaseAndApplication();
    const snapshot = proposedSnapshot([
      {
        id: "ev-new-event",
        sourceType: "application_event",
        sourceId: "evt-2",
        summary: "面接での評価を反映",
      },
      {
        id: "ev-reflection",
        sourceType: "user_input",
        sourceId: "reflection:abc123",
        summary: "ユーザーの振り返りメモ",
      },
    ]);

    const approved = service.approve(userA, {
      basePersonaVersionId: ids.personaVersionId,
      applicationId: ids.applicationId,
      requestId: "req-update-1",
      snapshot: snapshot,
    });

    expect(approved.version).toBe(2);
    const rows = connection.db.select().from(personaVersions).all();
    expect(rows).toHaveLength(2);
    const newRow = rows.find((row) => row.id === approved.personaVersionId);
    expect(newRow?.provenance.sourceIds).toContain("update-of:persona-base");
  });

  it("rejects approval citing a non-existent stage event without writing", () => {
    const ids = seedBaseAndApplication();
    expect(() =>
      service.approve(userA, {
        basePersonaVersionId: ids.personaVersionId,
        applicationId: ids.applicationId,
        requestId: "req-bad-1",
        snapshot: proposedSnapshot([
          {
            id: "ev-fake",
            sourceType: "application_event",
            sourceId: "evt-999",
            summary: "存在しないイベント",
          },
        ]),
      }),
    ).toThrow(AppError);
    expect(connection.db.select().from(personaVersions).all()).toHaveLength(1);
  });

  it("keeps users isolated on approve", () => {
    const ids = seedBaseAndApplication();
    expect(() =>
      service.approve(userB, {
        basePersonaVersionId: ids.personaVersionId,
        requestId: "req-cross-user",
        snapshot: proposedSnapshot(),
      }),
    ).toThrow(AppError);
  });
});
