import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  jobSnapshotSchema,
  JsonColumnValidationError,
  personaSnapshotSchema,
} from "@prizgram/shared";

import {
  createDatabase,
  databaseTriggers,
  listTriggerNames,
  matchScores,
  migrateDatabase,
  personaVersions,
  type DatabaseConnection,
} from "../src";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../drizzle");

let temporaryDirectory: string;
let connection: DatabaseConnection;

const validUpgradePersona = personaSnapshotSchema.parse({
  skills: [{ name: "TypeScript", level: "advanced", evidenceRefs: ["e1"] }],
  strengths: ["問題を分解できる"],
  weaknesses: ["発表経験が少ない"],
  values: ["透明性"],
  preferences: {
    roles: ["Engineer"],
    industries: [],
    workStyles: ["team"],
    locations: ["Tokyo"],
  },
  experiences: [],
  evidence: [
    { id: "e1", sourceType: "user_input", summary: "Webアプリを開発" },
  ],
  confidence: 0.8,
});

const validUpgradeJob = jobSnapshotSchema.parse({
  company: "Example",
  role: "Engineer",
  employmentType: "internship",
  description: "Product engineering internship",
  requirements: [{ id: "job:req:1", text: "TypeScript" }],
  desiredSkills: [],
  cultureValues: [{ id: "job:value:1", text: "Transparency" }],
  difficulty: { level: "competitive", evidenceRefs: ["job:req:1"] },
  source: {
    kind: "user_provided",
    name: "User",
    retrievedAt: "2026-08-25T00:00:00Z",
  },
});

const validUpgradeProvenance = {
  source: "user_input",
  sourceIds: ["hearing-1"],
  generatedAt: "2026-08-25T00:00:00Z",
};

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

function createInitialMigrationsFolder(entryCount = 1): string {
  const oldMigrationsFolder = path.join(temporaryDirectory, "old-migrations");
  fs.mkdirSync(path.join(oldMigrationsFolder, "meta"), { recursive: true });
  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as { entries: Array<{ idx: number; tag: string }> };
  for (const entry of journal.entries.slice(0, entryCount)) {
    fs.copyFileSync(
      path.join(migrationsFolder, `${entry.tag}.sql`),
      path.join(oldMigrationsFolder, `${entry.tag}.sql`),
    );
  }
  fs.writeFileSync(
    path.join(oldMigrationsFolder, "meta/_journal.json"),
    JSON.stringify({
      ...journal,
      entries: journal.entries.slice(0, entryCount),
    }),
  );
  return oldMigrationsFolder;
}

type MigrationJournal = { entries: Array<Record<string, unknown>> };

/** Appends one synthetic migration to a copy of the current bundle. */
function appendMigration(
  folderName: string,
  tag: string,
  statements: string[],
  when: number,
): string {
  const extraFolder = path.join(temporaryDirectory, folderName);
  fs.cpSync(migrationsFolder, extraFolder, { recursive: true });
  fs.writeFileSync(
    path.join(extraFolder, `${tag}.sql`),
    statements.join("--> statement-breakpoint\n"),
  );
  const journalPath = path.join(extraFolder, "meta/_journal.json");
  const journal = JSON.parse(
    fs.readFileSync(journalPath, "utf8"),
  ) as MigrationJournal;
  journal.entries.push({
    idx: journal.entries.length,
    version: "6",
    when,
    tag,
    breakpoints: true,
  });
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return extraFolder;
}

/**
 * Builds a migration bundle identical to the current one plus two extra
 * migrations: one harmless schema change followed by one that inserts a row
 * violating a foreign key.
 */
function createFkViolatingMigrationsFolder(): string {
  const withSchemaChange = appendMigration(
    "fk-violating-migrations",
    "0004_users_probe_column",
    ["alter table users add column probe text;"],
    Date.parse("2027-01-03T00:00:00Z"),
  );
  const journalPath = path.join(withSchemaChange, "meta/_journal.json");
  const journal = JSON.parse(
    fs.readFileSync(journalPath, "utf8"),
  ) as MigrationJournal;
  journal.entries.push({
    idx: journal.entries.length,
    version: "6",
    when: Date.parse("2027-01-04T00:00:00Z"),
    tag: "0005_orphan_persona",
    breakpoints: true,
  });
  fs.writeFileSync(
    path.join(withSchemaChange, "0005_orphan_persona.sql"),
    [
      "insert into persona_versions (id, user_id, version, snapshot, provenance) values (",
      "'orphan-persona',",
      "'ghost-user',",
      "1,",
      `'${JSON.stringify({
        confidence: 0,
        evidence: [],
        experiences: [],
        preferences: {
          industries: [],
          locations: [],
          roles: [],
          workStyles: [],
        },
        skills: [],
        strengths: [],
        values: [],
        weaknesses: [],
      })}',`,
      `'${JSON.stringify({
        generatedAt: "2026-08-25T00:00:00Z",
        source: "user_input",
        sourceIds: ["legacy"],
      })}');`,
    ].join(""),
  );
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return withSchemaChange;
}

/**
 * Builds a migration bundle identical to the current one plus an extra
 * migration that converts legacy persona rows into the current shape,
 * following the same drop-trigger / rebuild pattern as past migrations.
 */
function createConvertingMigrationsFolder(): string {
  const convertingFolder = path.join(
    temporaryDirectory,
    "converting-migrations",
  );
  fs.cpSync(migrationsFolder, convertingFolder, { recursive: true });
  fs.writeFileSync(
    path.join(convertingFolder, "0004_convert_legacy_persona.sql"),
    [
      "drop trigger persona_versions_immutable;",
      `update persona_versions
         set snapshot = '{"skills":[],"strengths":[],"weaknesses":[],"values":[],"preferences":{"roles":[],"industries":[],"workStyles":[],"locations":[]},"experiences":[],"evidence":[],"confidence":0}',
             provenance = '{"source":"user_input","sourceIds":["legacy"],"generatedAt":"2026-08-25T00:00:00Z"}'
       where json_extract(snapshot, '$.evidence') is null;`,
      "create trigger persona_versions_immutable",
      "before update on persona_versions",
      "begin",
      "  select raise(abort, 'persona versions are immutable');",
      "end;",
    ].join("\n"),
  );
  type Journal = { entries: Array<Record<string, unknown>> };
  const journalPath = path.join(convertingFolder, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as Journal;
  journal.entries.push({
    idx: journal.entries.length,
    version: "6",
    when: Date.parse("2027-01-02T00:00:00Z"),
    tag: "0004_convert_legacy_persona",
    breakpoints: true,
  });
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return convertingFolder;
}

/**
 * Builds a migration bundle identical to the current one plus an extra
 * migration that only alters an existing table, so the table set stays the
 * same while the schema drifts.
 */
function createExtendedMigrationsFolder(): string {
  const extendedFolder = path.join(temporaryDirectory, "extended-migrations");
  fs.cpSync(migrationsFolder, extendedFolder, { recursive: true });
  fs.writeFileSync(
    path.join(extendedFolder, "0003_probe_column.sql"),
    "alter table users add column probe text;",
  );
  type Journal = { entries: Array<Record<string, unknown>> };
  const journalPath = path.join(extendedFolder, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as Journal;
  journal.entries.push({
    idx: journal.entries.length,
    version: "6",
    when: Date.parse("2027-01-01T00:00:00Z"),
    tag: "0003_probe_column",
    breakpoints: true,
  });
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return extendedFolder;
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

  it("upgrades an existing database with referenced version rows", () => {
    const oldMigrationsFolder = createInitialMigrationsFolder();

    const upgradeConnection = createDatabase(
      path.join(temporaryDirectory, "upgrade.sqlite"),
    );
    try {
      migrateDatabase(upgradeConnection, oldMigrationsFolder);
      upgradeConnection.sqlite
        .prepare("insert into users (id) values (?)")
        .run("upgrade-user");
      upgradeConnection.sqlite
        .prepare(
          "insert into persona_versions (id, user_id, version, snapshot, provenance) values (?, ?, 1, ?, ?)",
        )
        .run(
          "upgrade-persona",
          "upgrade-user",
          JSON.stringify(validUpgradePersona),
          JSON.stringify(validUpgradeProvenance),
        );
      upgradeConnection.sqlite
        .prepare("insert into jobs (id, user_id) values (?, ?)")
        .run("upgrade-job", "upgrade-user");
      upgradeConnection.sqlite
        .prepare(
          "insert into job_versions (id, user_id, job_id, version, snapshot, content_hash) values (?, ?, ?, 1, ?, ?)",
        )
        .run(
          "upgrade-job-version",
          "upgrade-user",
          "upgrade-job",
          JSON.stringify(validUpgradeJob),
          "upgrade-hash",
        );
      upgradeConnection.sqlite
        .prepare(
          `insert into match_scores (
            id, user_id, persona_version_id, job_version_id,
            skill_fit_score, skill_fit_reasons, skill_fit_evidence_refs,
            culture_value_fit_score, culture_value_fit_reasons, culture_value_fit_evidence_refs,
            difficulty_gap_score, difficulty_gap_reasons, difficulty_gap_evidence_refs,
            model, prompt_version
          ) values (?, ?, ?, ?, 70, '["reason"]', '["e1"]', 60, '["reason"]', '["job:value:1"]', 30, '["reason"]', '["job:req:1"]', 'model', 'v1')`,
        )
        .run(
          "upgrade-score",
          "upgrade-user",
          "upgrade-persona",
          "upgrade-job-version",
        );

      migrateDatabase(upgradeConnection, migrationsFolder);

      expect(
        upgradeConnection.sqlite
          .prepare("select id from match_scores where id = ?")
          .get("upgrade-score"),
      ).toEqual({ id: "upgrade-score" });
      expect(
        upgradeConnection.sqlite.pragma("foreign_keys", { simple: true }),
      ).toBe(1);
      expect(upgradeConnection.sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(
        upgradeConnection.db.select().from(personaVersions).get()?.snapshot
          .skills[0]?.name,
      ).toBe("TypeScript");
      expect(
        upgradeConnection.db.select().from(matchScores).get()?.skillFitReasons,
      ).toEqual(["reason"]);
    } finally {
      upgradeConnection.close();
    }
  });

  it("refuses to migrate legacy JSON that violates the domain schema without leaving partial changes", () => {
    const legacyConnection = createDatabase(
      path.join(temporaryDirectory, "invalid-upgrade.sqlite"),
    );
    try {
      migrateDatabase(legacyConnection, createInitialMigrationsFolder());
      legacyConnection.sqlite
        .prepare("insert into users (id) values (?)")
        .run("legacy-user");
      legacyConnection.sqlite
        .prepare(
          "insert into persona_versions (id, user_id, version, snapshot, provenance) values (?, ?, 1, ?, ?)",
        )
        .run("legacy-persona", "legacy-user", "{}", "{}");

      expect(() => migrateDatabase(legacyConnection, migrationsFolder)).toThrow(
        JsonColumnValidationError,
      );
      expect(
        legacyConnection.sqlite
          .prepare("select count(*) as count from __drizzle_migrations")
          .get(),
      ).toEqual({ count: 1 });
      expect(
        legacyConnection.sqlite
          .prepare("select snapshot from persona_versions where id = ?")
          .get("legacy-persona"),
      ).toEqual({ snapshot: "{}" });
    } finally {
      legacyConnection.close();
    }
  });

  it("converts legacy rows during migration before validating them against the current schema", () => {
    const convertingFolder = createConvertingMigrationsFolder();
    const legacyConnection = createDatabase(
      path.join(temporaryDirectory, "converting-upgrade.sqlite"),
      { migrationsFolder: convertingFolder },
    );
    try {
      migrateDatabase(legacyConnection, createInitialMigrationsFolder());
      legacyConnection.sqlite
        .prepare("insert into users (id) values (?)")
        .run("legacy-user");
      legacyConnection.sqlite
        .prepare(
          "insert into persona_versions (id, user_id, version, snapshot, provenance) values (?, ?, 1, ?, ?)",
        )
        .run("legacy-persona", "legacy-user", "{}", "{}");

      // Legacy rows are invalid under the current schema but the conversion
      // migration transforms them before validation runs.
      expect(() =>
        migrateDatabase(legacyConnection, convertingFolder),
      ).not.toThrow();
      expect(
        legacyConnection.sqlite
          .prepare("select count(*) as count from __drizzle_migrations")
          .get(),
      ).toEqual({ count: 4 });

      const row = legacyConnection.db.select().from(personaVersions).get();
      expect(row?.snapshot.confidence).toBe(0);
      expect(row?.provenance.source).toBe("user_input");

      // The immutability trigger is restored by the conversion migration.
      expect(() =>
        legacyConnection.sqlite
          .prepare("update persona_versions set version = 2 where id = ?")
          .run("legacy-persona"),
      ).toThrow(/immutable/);
      expect(legacyConnection.ready()).toEqual({ ready: true });
    } finally {
      legacyConnection.close();
    }
  });

  it("rolls back migrations that introduce foreign key violations", () => {
    const violatingFolder = createFkViolatingMigrationsFolder();
    const victimConnection = createDatabase(
      path.join(temporaryDirectory, "fk-violation.sqlite"),
      { migrationsFolder: violatingFolder },
    );
    try {
      migrateDatabase(victimConnection, createInitialMigrationsFolder());
      victimConnection.sqlite
        .prepare("insert into users (id) values (?)")
        .run("legacy-user");

      expect(() => migrateDatabase(victimConnection, violatingFolder)).toThrow(
        /foreign key violations/,
      );

      // The migration journal still only contains the initial migration.
      expect(
        victimConnection.sqlite
          .prepare("select count(*) as count from __drizzle_migrations")
          .get(),
      ).toEqual({ count: 1 });

      // Pre-existing data is completely intact and no orphan row remains.
      expect(
        victimConnection.sqlite.prepare("select id from users").all(),
      ).toEqual([{ id: "legacy-user" }]);
      expect(
        victimConnection.sqlite
          .prepare("select count(*) as count from persona_versions")
          .get(),
      ).toEqual({ count: 0 });

      // No schema change from the failed batch was partially applied: the
      // auth tables (added by a pending migration) do not exist and the
      // probe column was not added either.
      expect(
        victimConnection.sqlite
          .prepare(
            "select name from sqlite_master where type = 'table' and name = 'auth_sessions'",
          )
          .get(),
      ).toBeUndefined();
      const userColumns = victimConnection.sqlite
        .prepare("pragma table_info(users)")
        .all() as Array<{ name: string }>;
      expect(userColumns.map(({ name }) => name)).not.toContain("probe");

      // The connection stays usable with foreign keys re-enabled.
      expect(
        victimConnection.sqlite.pragma("foreign_keys", { simple: true }),
      ).toBe(1);
      // Readiness still refuses to report the unmigrated database healthy.
      expect(() => victimConnection.ready()).toThrow(/migrations/);
    } finally {
      victimConnection.close();
    }
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

  it("rejects malformed JSON and validates JSON columns when reading", () => {
    connection.sqlite
      .prepare("insert into users (id) values (?)")
      .run("user-a");

    expect(() =>
      connection.sqlite
        .prepare(
          "insert into persona_versions (id, user_id, version, snapshot, provenance) values (?, ?, 1, ?, ?)",
        )
        .run("malformed", "user-a", "not-json", "{}"),
    ).toThrow();

    connection.sqlite
      .prepare(
        "insert into persona_versions (id, user_id, version, snapshot, provenance) values (?, ?, 1, ?, ?)",
      )
      .run("invalid-domain", "user-a", "{}", "{}");

    expect(() => connection.db.select().from(personaVersions).all()).toThrow(
      JsonColumnValidationError,
    );
  });

  it("advances updated_at when mutable records change", () => {
    seedInputs();
    connection.sqlite
      .prepare(
        "insert into applications (id, user_id, job_id, status) values (?, ?, ?, ?)",
      )
      .run("application-a", "user-a", "job-a", "saved");
    const before = connection.sqlite
      .prepare("select updated_at as updatedAt from applications where id = ?")
      .get("application-a") as { updatedAt: number };

    connection.sqlite
      .prepare("update applications set status = ? where id = ?")
      .run("applying", "application-a");
    const after = connection.sqlite
      .prepare("select updated_at as updatedAt from applications where id = ?")
      .get("application-a") as { updatedAt: number };

    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
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

  it("reports a stale schema with an unchanged table set as not ready until migrated", () => {
    const extendedFolder = createExtendedMigrationsFolder();
    const staleConnection = createDatabase(
      path.join(temporaryDirectory, "stale.sqlite"),
      { migrationsFolder: extendedFolder },
    );
    try {
      // The DB is fully migrated for the previous bundle; the pending
      // migration only alters an existing table, so the table set matches.
      migrateDatabase(staleConnection, migrationsFolder);
      expect(() => staleConnection.ready()).toThrow(
        /does not match the bundled migrations/,
      );
      migrateDatabase(staleConnection, extendedFolder);
      expect(staleConnection.ready()).toEqual({ ready: true });
    } finally {
      staleConnection.close();
    }
  });

  it("reports a database migrated beyond the bundled migrations as not ready", () => {
    const extendedFolder = createExtendedMigrationsFolder();
    const aheadConnection = createDatabase(
      path.join(temporaryDirectory, "ahead.sqlite"),
    );
    try {
      migrateDatabase(aheadConnection, extendedFolder);
      expect(() => aheadConnection.ready()).toThrow(
        /does not match the bundled migrations/,
      );
    } finally {
      aheadConnection.close();
    }
  });

  it("reports a duplicated journal entry as not ready even when every hash is present", () => {
    expect(connection.ready()).toEqual({ ready: true });
    // A hash-set comparison would accept this journal because the duplicated
    // entry contributes no unknown hash.
    connection.sqlite
      .prepare(
        `insert into "__drizzle_migrations" ("hash", "created_at")
         select "hash", "created_at" + 1 from "__drizzle_migrations"
         order by "created_at" desc limit 1`,
      )
      .run();
    expect(() => connection.ready()).toThrow(
      /does not match the bundled migrations/,
    );
  });

  it("reports reordered journal entries as not ready", () => {
    expect(connection.ready()).toEqual({ ready: true });
    const rows = connection.sqlite
      .prepare(
        'select rowid as id, hash from "__drizzle_migrations" order by created_at asc',
      )
      .all() as Array<{ id: number; hash: string }>;
    const [first, second] = rows;
    const updateHash = connection.sqlite.prepare(
      'update "__drizzle_migrations" set hash = ? where rowid = ?',
    );
    if (first !== undefined && second !== undefined) {
      updateHash.run(second.hash, first.id);
      updateHash.run(first.hash, second.id);
    }
    expect(() => connection.ready()).toThrow(
      /does not match the bundled migrations/,
    );
  });

  it("reports tampered journal timestamps and hashes as not ready", () => {
    expect(connection.ready()).toEqual({ ready: true });
    connection.sqlite
      .prepare('update "__drizzle_migrations" set created_at = created_at + 1')
      .run();
    expect(() => connection.ready()).toThrow(
      /does not match the bundled migrations/,
    );

    connection.sqlite
      .prepare(
        'update "__drizzle_migrations" set created_at = created_at - 1, hash = ? where rowid = (select min(rowid) from "__drizzle_migrations")',
      )
      .run("f".repeat(64));
    expect(() => connection.ready()).toThrow(
      /does not match the bundled migrations/,
    );
  });

  it("reports foreign key violations as not ready", () => {
    expect(connection.ready()).toEqual({ ready: true });
    connection.sqlite.pragma("foreign_keys = OFF");
    try {
      connection.sqlite
        .prepare(
          "insert into persona_versions (id, user_id, version, snapshot, provenance) values ('fk-orphan', 'ghost-user', 1, '{}', '{}')",
        )
        .run();
    } finally {
      connection.sqlite.pragma("foreign_keys = ON");
    }
    expect(() => connection.ready()).toThrow(/foreign key violations/);
  });

  it("keeps readiness green after a clean migration and a re-opened connection", () => {
    expect(connection.ready()).toEqual({ ready: true });
    const reopened = createDatabase(
      path.join(temporaryDirectory, "test.sqlite"),
    );
    try {
      expect(reopened.ready()).toEqual({ ready: true });
    } finally {
      reopened.close();
    }
  });

  it("requires source kind and external id on jobs to be set together", () => {
    seedInputs();
    const insert = connection.sqlite.prepare(
      "insert into jobs (id, user_id, source_kind, source_external_id) values (?, ?, ?, ?)",
    );
    expect(() =>
      insert.run("job-kind-only", "user-a", "official_api", null),
    ).toThrow(/CHECK constraint failed: jobs_source_pair_consistency/);
    expect(() =>
      insert.run("job-external-only", "user-a", null, "ext-1"),
    ).toThrow(/CHECK constraint failed: jobs_source_pair_consistency/);

    insert.run("job-unsourced-a", "user-b", null, null);
    insert.run("job-unsourced-b", "user-b", null, null);
    insert.run("job-sourced", "user-b", "official_api", "ext-1");
    expect(() =>
      insert.run("job-sourced-duplicate", "user-b", "official_api", "ext-1"),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("migrates a pre-constraint database forward preserving data and triggers", () => {
    const previousMigrationsFolder = createInitialMigrationsFolder(3);
    const legacyConnection = createDatabase(
      path.join(temporaryDirectory, "legacy.sqlite"),
    );
    try {
      migrateDatabase(legacyConnection, previousMigrationsFolder);
      legacyConnection.sqlite
        .prepare("insert into users (id) values (?)")
        .run("user-legacy");
      legacyConnection.sqlite
        .prepare(
          "insert into jobs (id, user_id, source_kind, source_external_id) values (?, ?, ?, ?)",
        )
        .run("job-legacy", "user-legacy", "official_api", "ext-legacy");

      migrateDatabase(legacyConnection, migrationsFolder);

      expect(legacyConnection.ready()).toEqual({ ready: true });
      expect(
        legacyConnection.sqlite.prepare("select id from jobs").all(),
      ).toEqual([{ id: "job-legacy" }]);
      expect(listTriggerNames(legacyConnection.sqlite)).toHaveLength(
        databaseTriggers.length,
      );
      expect(
        legacyConnection.sqlite.pragma("foreign_keys", { simple: true }),
      ).toBe(1);
      expect(() =>
        legacyConnection.sqlite
          .prepare(
            "insert into jobs (id, user_id, source_kind, source_external_id) values ('job-bad', 'user-legacy', 'kind-only', null)",
          )
          .run(),
      ).toThrow(/jobs_source_pair_consistency/);
    } finally {
      legacyConnection.close();
    }
  });

  it("refuses to migrate when stored jobs rows violate the source pairing rule", () => {
    const previousMigrationsFolder = createInitialMigrationsFolder(3);
    const legacyConnection = createDatabase(
      path.join(temporaryDirectory, "violating.sqlite"),
    );
    try {
      migrateDatabase(legacyConnection, previousMigrationsFolder);
      legacyConnection.sqlite
        .prepare("insert into users (id) values (?)")
        .run("user-x");
      legacyConnection.sqlite
        .prepare(
          "insert into jobs (id, user_id, source_kind) values ('job-x', 'user-x', 'k')",
        )
        .run();

      expect(() => migrateDatabase(legacyConnection, migrationsFolder)).toThrow(
        /not set together/,
      );

      const applied = legacyConnection.sqlite
        .prepare("select count(*) as count from __drizzle_migrations")
        .get() as { count: number };
      expect(applied.count).toBe(3);
      expect(
        legacyConnection.sqlite.prepare("select id from jobs").all(),
      ).toEqual([{ id: "job-x" }]);
    } finally {
      legacyConnection.close();
    }
  });
});
