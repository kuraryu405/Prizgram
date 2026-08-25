import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { z } from "zod";

import {
  decodeJsonColumn,
  evidenceIdListSchema,
  generationProvenanceSchema,
  jobSnapshotSchema,
  personaSnapshotSchema,
  scoreReasonListSchema,
} from "@prizgram/shared";

import {
  databasePathFromUrl,
  findWorkspaceRoot,
  type DatabasePathOptions,
} from "./config";
import { schema, tableNames } from "./schema";

export {
  databasePathFromUrl,
  databaseUrlFromEnvironment,
  loadPrizgramEnvironment,
} from "./config";

export type DatabaseConnection = ReturnType<typeof createDatabase>;

export interface CreateDatabaseOptions extends DatabasePathOptions {
  /**
   * Migration bundle used by readiness checks. Defaults to the workspace
   * `packages/db/drizzle` folder; standalone deployments should pass the
   * folder bundled with the deployed artifact explicitly.
   */
  migrationsFolder?: string;
}

type MigrationMetaList = ReturnType<typeof readMigrationFiles>;

const migrationMetaCache = new Map<string, MigrationMetaList>();

function bundledMigrations(migrationsFolder: string): MigrationMetaList {
  let migrations = migrationMetaCache.get(migrationsFolder);
  if (migrations === undefined) {
    migrations = readMigrationFiles({ migrationsFolder });
    migrationMetaCache.set(migrationsFolder, migrations);
  }
  return migrations;
}

function resolveDefaultMigrationsFolder(startingDirectory: string): string {
  const workspaceRoot = findWorkspaceRoot(startingDirectory);
  if (workspaceRoot !== undefined)
    return path.join(workspaceRoot, "packages", "db", "drizzle");
  // Native ESM execution (for example the migration CLI) keeps the bundle
  // next to this module.
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../drizzle",
  );
}

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
  options?: CreateDatabaseOptions,
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

  const migrationsFolder =
    options?.migrationsFolder ?? resolveDefaultMigrationsFolder(process.cwd());

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

      // Table presence alone misses column/index/trigger/FK-only changes,
      // and comparing hash *sets* would miss journal drift. Compare the
      // applied journal as an ordered sequence (drizzle orders by
      // created_at) against the bundled sequence: count, order, hash, and
      // creation timestamp must all line up.
      let appliedRows: Array<{ hash: string; created_at: number | string }>;
      try {
        appliedRows = sqlite
          .prepare(
            'select hash, created_at from "__drizzle_migrations" order by created_at asc, rowid asc',
          )
          .all() as Array<{ hash: string; created_at: number | string }>;
      } catch (error) {
        throw new Error("Database migrations have not been fully applied", {
          cause: error,
        });
      }
      const expectedMigrations = bundledMigrations(migrationsFolder);
      const journalMatches =
        appliedRows.length === expectedMigrations.length &&
        expectedMigrations.every((migration, index) => {
          const appliedRow = appliedRows[index];
          return (
            appliedRow !== undefined &&
            appliedRow.hash === migration.hash &&
            Number(appliedRow.created_at) === migration.folderMillis
          );
        });
      if (!journalMatches) {
        throw new Error(
          "Applied database schema does not match the bundled migrations; apply pending migrations before serving traffic",
        );
      }

      const foreignKeyViolations = sqlite.pragma("foreign_key_check") as
        unknown[] | undefined;
      if ((foreignKeyViolations?.length ?? 0) > 0)
        throw new Error("Database contains foreign key violations");

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
