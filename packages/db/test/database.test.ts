import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from "../src";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../drizzle");

let temporaryDirectory: string;
let connection: DatabaseConnection;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "prizgram-db-test-"),
  );
  connection = createDatabase(path.join(temporaryDirectory, "test.sqlite"));
  migrateDatabase(connection, migrationsFolder);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function seedInputs(): void {
  connection.sqlite
    .prepare("insert into users (id) values (?), (?)")
    .run("user-a", "user-b");
  connection.sqlite
    .prepare(
      "insert into persona_versions (id, user_id, version, snapshot, provenance) values (?, ?, 1, ?, ?)",
    )
    .run("persona-a-1", "user-a", "{}", "{}");
  connection.sqlite
    .prepare("insert into jobs (id, user_id) values (?, ?), (?, ?)")
    .run("job-a", "user-a", "job-b", "user-b");
  connection.sqlite
    .prepare(
      "insert into job_versions (id, user_id, job_id, version, snapshot, content_hash) values (?, ?, ?, 1, ?, ?)",
    )
    .run("job-version-a-1", "user-a", "job-a", "{}", "hash-a");
}

describe("SQLite foundation", () => {
  it("applies migrations with foreign key enforcement", () => {
    expect(connection.ready()).toEqual({ ready: true });
    expect(connection.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    const table = connection.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name = 'match_scores'",
      )
      .get();
    expect(table).toEqual({ name: "match_scores" });
  });

  it("reports an unmigrated database as not ready", () => {
    const unmigrated = createDatabase(":memory:");
    try {
      expect(() => unmigrated.ready()).toThrow(/migrations/);
    } finally {
      unmigrated.close();
    }
  });

  it("reports a partially migrated database as not ready", () => {
    connection.sqlite.exec("drop table reminders");
    expect(() => connection.ready()).toThrow(/fully applied/);
  });

  it("rejects cross-user references and out-of-range scores", () => {
    seedInputs();
    expect(() =>
      connection.sqlite
        .prepare(
          "insert into applications (id, user_id, job_id, status) values (?, ?, ?, ?)",
        )
        .run("application-invalid-owner", "user-b", "job-a", "saved"),
    ).toThrow();

    expect(() =>
      connection.sqlite
        .prepare(
          `insert into match_scores (
            id, user_id, persona_version_id, job_version_id,
            skill_fit_score, skill_fit_reasons, skill_fit_evidence_refs,
            culture_value_fit_score, culture_value_fit_reasons, culture_value_fit_evidence_refs,
            difficulty_gap_score, difficulty_gap_reasons, difficulty_gap_evidence_refs,
            model, prompt_version
          ) values (?, ?, ?, ?, ?, '[]', '[]', 50, '[]', '[]', 20, '[]', '[]', 'model', 'v1')`,
        )
        .run("score-invalid", "user-a", "persona-a-1", "job-version-a-1", 101),
    ).toThrow();
  });

  it("allows the same inputs to be reassessed by a new prompt while deduplicating identical generations", () => {
    seedInputs();
    const insertScore = connection.sqlite.prepare(
      `insert into match_scores (
        id, user_id, persona_version_id, job_version_id,
        skill_fit_score, skill_fit_reasons, skill_fit_evidence_refs,
        culture_value_fit_score, culture_value_fit_reasons, culture_value_fit_evidence_refs,
        difficulty_gap_score, difficulty_gap_reasons, difficulty_gap_evidence_refs,
        model, prompt_version
      ) values (?, 'user-a', 'persona-a-1', 'job-version-a-1', 70, '["reason"]', '["e1"]', 60, '["reason"]', '["e2"]', 30, '["reason"]', '["e3"]', 'model', ?)`,
    );
    insertScore.run("score-v1", "v1");
    insertScore.run("score-v2", "v2");
    expect(() => insertScore.run("score-v2-duplicate", "v2")).toThrow();
    expect(
      connection.sqlite
        .prepare("select count(*) as count from match_scores")
        .get(),
    ).toEqual({ count: 2 });
  });

  it("keeps snapshots immutable", () => {
    seedInputs();
    expect(() =>
      connection.sqlite
        .prepare("update persona_versions set snapshot = ? where id = ?")
        .run('{"changed":true}', "persona-a-1"),
    ).toThrow(/immutable/);
    expect(() =>
      connection.sqlite
        .prepare("update job_versions set snapshot = ? where id = ?")
        .run('{"changed":true}', "job-version-a-1"),
    ).toThrow(/immutable/);
  });

  it("deduplicates reminders and rolls back failed transactions", () => {
    seedInputs();
    connection.sqlite
      .prepare(
        "insert into applications (id, user_id, job_id, status) values (?, ?, ?, ?)",
      )
      .run("application-a", "user-a", "job-a", "saved");
    connection.sqlite
      .prepare(
        "insert into application_deadlines (id, user_id, application_id, kind, title, due_at, timezone) values (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "deadline-a",
        "user-a",
        "application-a",
        "application",
        "ES",
        Date.now(),
        "Asia/Tokyo",
      );
    const insertReminder = connection.sqlite.prepare(
      "insert into reminders (id, user_id, deadline_id, scheduled_for, priority, message, dedupe_key) values (?, ?, ?, ?, ?, ?, ?)",
    );
    insertReminder.run(
      "reminder-a",
      "user-a",
      "deadline-a",
      Date.now(),
      "high",
      "締切が近づいています",
      "deadline-a:24h",
    );
    expect(() =>
      insertReminder.run(
        "reminder-b",
        "user-a",
        "deadline-a",
        Date.now(),
        "high",
        "重複",
        "deadline-a:24h",
      ),
    ).toThrow();

    const createUsers = connection.sqlite.transaction(() => {
      connection.sqlite
        .prepare("insert into users (id) values (?)")
        .run("rollback-a");
      connection.sqlite
        .prepare("insert into users (id) values (?)")
        .run("rollback-a");
    });
    expect(createUsers).toThrow();
    expect(
      connection.sqlite
        .prepare("select id from users where id = ?")
        .get("rollback-a"),
    ).toBeUndefined();
  });

  it("deletes all owned and derived rows when a user is deleted", () => {
    seedInputs();
    connection.sqlite
      .prepare(
        "insert into applications (id, user_id, job_id, status) values (?, ?, ?, ?)",
      )
      .run("application-a", "user-a", "job-a", "saved");
    connection.sqlite
      .prepare(
        `insert into match_scores (
          id, user_id, persona_version_id, job_version_id,
          skill_fit_score, skill_fit_reasons, skill_fit_evidence_refs,
          culture_value_fit_score, culture_value_fit_reasons, culture_value_fit_evidence_refs,
          difficulty_gap_score, difficulty_gap_reasons, difficulty_gap_evidence_refs,
          model, prompt_version
        ) values ('score-a', 'user-a', 'persona-a-1', 'job-version-a-1', 70, '["reason"]', '["e1"]', 60, '["reason"]', '["e2"]', 30, '["reason"]', '["e3"]', 'model', 'v1')`,
      )
      .run();

    connection.sqlite.prepare("delete from users where id = ?").run("user-a");
    for (const table of [
      "persona_versions",
      "jobs",
      "job_versions",
      "match_scores",
      "applications",
    ]) {
      expect(
        connection.sqlite
          .prepare(`select count(*) as count from ${table} where user_id = ?`)
          .get("user-a"),
      ).toEqual({
        count: 0,
      });
    }
  });
});
