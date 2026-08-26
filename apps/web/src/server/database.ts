import "server-only";

import {
  createDatabase,
  databaseUrlFromEnvironment,
  loadPrizgramEnvironment,
  type DatabaseConnection,
} from "@prizgram/db";

declare global {
  var prizgramDatabase: DatabaseConnection | undefined;
}

function initializeDatabase(): DatabaseConnection {
  loadPrizgramEnvironment();
  const migrationsFolder =
    process.env["PRIZGRAM_MIGRATIONS_DIR"]?.trim() || undefined;

  return createDatabase(
    databaseUrlFromEnvironment(),
    migrationsFolder === undefined ? undefined : { migrationsFolder },
  );
}

export function getDatabase(): DatabaseConnection {
  globalThis.prizgramDatabase ??= initializeDatabase();
  return globalThis.prizgramDatabase;
}
