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
  return createDatabase(databaseUrlFromEnvironment());
}

export function getDatabase(): DatabaseConnection {
  globalThis.prizgramDatabase ??= initializeDatabase();
  return globalThis.prizgramDatabase;
}
