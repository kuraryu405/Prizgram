import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";

import { schema, tableNames } from "./schema";

const databaseUrlSchema = z.string().trim().min(1);

export type DatabaseConnection = ReturnType<typeof createDatabase>;

export function databasePathFromUrl(databaseUrl: string): string {
  const parsed = databaseUrlSchema.parse(databaseUrl);
  if (parsed === ":memory:" || parsed.startsWith("file:") === false)
    return parsed;
  return parsed.slice("file:".length);
}

export function createDatabase(databaseUrl: string) {
  const filename = databasePathFromUrl(databaseUrl);
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
  migrate(connection.db, { migrationsFolder });
}
