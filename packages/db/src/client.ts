import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { z } from "zod";

import {
  decodeJsonColumn,
  evidenceIdListSchema,
  generationProvenanceSchema,
  jobSnapshotSchema,
  personaSnapshotSchema,
  scoreReasonListSchema,
} from "@prizgram/shared";

import { databasePathFromUrl, type DatabasePathOptions } from "./config";
import { schema, tableNames } from "./schema";

export {
  databasePathFromUrl,
  databaseUrlFromEnvironment,
  loadPrizgramEnvironment,
} from "./config";

export type DatabaseConnection = ReturnType<typeof createDatabase>;

const structuredColumns: ReadonlyArray<{
  table: string;
  column: string;
  schema: z.ZodType;
}> = [
  {
    table: "persona_versions",
    column: "snapshot",
    schema: personaSnapshotSchema,
  },
  {
    table: "persona_versions",
    column: "provenance",
    schema: generationProvenanceSchema,
  },
  { table: "job_versions", column: "snapshot", schema: jobSnapshotSchema },
  {
    table: "match_scores",
    column: "skill_fit_reasons",
    schema: scoreReasonListSchema,
  },
  {
    table: "match_scores",
    column: "skill_fit_evidence_refs",
    schema: evidenceIdListSchema,
  },
  {
    table: "match_scores",
    column: "culture_value_fit_reasons",
    schema: scoreReasonListSchema,
  },
  {
    table: "match_scores",
    column: "culture_value_fit_evidence_refs",
    schema: evidenceIdListSchema,
  },
  {
    table: "match_scores",
    column: "difficulty_gap_reasons",
    schema: scoreReasonListSchema,
  },
  {
    table: "match_scores",
    column: "difficulty_gap_evidence_refs",
    schema: evidenceIdListSchema,
  },
];

function validateExistingStructuredData(sqlite: BetterSqlite3.Database): void {
  for (const { column, schema: columnSchema, table } of structuredColumns) {
    const exists = sqlite
      .prepare(
        "select 1 from sqlite_master where type = 'table' and name = ? limit 1",
      )
      .get(table);
    if (exists === undefined) continue;

    const rows = sqlite
      .prepare(`select \`${column}\` as value from \`${table}\``)
      .all() as Array<{ value: string }>;
    for (const { value } of rows) {
      decodeJsonColumn(`${table}.${column}`, columnSchema, value);
    }
  }
}

export function createDatabase(
  databaseUrl: string,
  options?: DatabasePathOptions,
) {
  const filename = databasePathFromUrl(databaseUrl, options);
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }

  const sqlite = new BetterSqlite3(filename);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  if (filename !== ":memory:") sqlite.pragma("journal_mode = WAL");

  const foreignKeys = sqlite.pragma("foreign_keys", { simple: true });
  if (foreignKeys !== 1) {
    sqlite.close();
    throw new Error("SQLite foreign key enforcement could not be enabled");
  }

  const db = drizzle(sqlite, { schema });
  return {
    db,
    sqlite,
    close: () => sqlite.close(),
    ready: () => {
      const placeholders = tableNames.map(() => "?").join(",");
      const rows = sqlite
        .prepare(
          `select name from sqlite_master where type = 'table' and name in (${placeholders})`,
        )
        .all(...tableNames) as Array<{ name: string }>;
      const existing = new Set(rows.map(({ name }) => name));
      const missing = tableNames.filter((name) => !existing.has(name));
      if (missing.length > 0)
        throw new Error("Database migrations have not been fully applied");
      return { ready: true as const };
    },
  };
}

export function migrateDatabase(
  connection: DatabaseConnection,
  migrationsFolder: string,
): void {
  // Refuse to mutate a legacy database whose JSON rows cannot be exposed
  // through the current domain types after the migration.
  validateExistingStructuredData(connection.sqlite);
  const violationsBefore = connection.sqlite.pragma("foreign_key_check") as
    unknown[] | undefined;
  if ((violationsBefore?.length ?? 0) > 0) {
    throw new Error(
      "Database contains foreign key violations before migration",
    );
  }

  // SQLite ignores PRAGMA foreign_keys changes inside a transaction. Drizzle
  // wraps each migration in a transaction, so table-rebuild migrations must
  // disable enforcement before entering the migrator.
  connection.sqlite.pragma("foreign_keys = OFF");
  try {
    migrate(connection.db, { migrationsFolder });
  } finally {
    connection.sqlite.pragma("foreign_keys = ON");
  }

  const violationsAfter = connection.sqlite.pragma("foreign_key_check") as
    unknown[] | undefined;
  if ((violationsAfter?.length ?? 0) > 0) {
    throw new Error("Database contains foreign key violations after migration");
  }
  validateExistingStructuredData(connection.sqlite);
}
