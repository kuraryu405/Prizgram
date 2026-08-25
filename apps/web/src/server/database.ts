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

export const database = globalThis.prizgramDatabase ?? initializeDatabase();

if (process.env.NODE_ENV !== "production") {
  globalThis.prizgramDatabase = database;
}
