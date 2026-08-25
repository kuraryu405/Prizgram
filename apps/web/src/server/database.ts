import "server-only";

import { createDatabase, type DatabaseConnection } from "@prizgram/db";

declare global {
  var prizgramDatabase: DatabaseConnection | undefined;
}

function initializeDatabase(): DatabaseConnection {
  return createDatabase(
    process.env.DATABASE_URL ?? "file:./data/prizgram.sqlite",
  );
}

export const database = globalThis.prizgramDatabase ?? initializeDatabase();

if (process.env.NODE_ENV !== "production") {
  globalThis.prizgramDatabase = database;
}
