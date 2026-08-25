import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase, migrateDatabase } from "./client";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(currentDirectory, "../drizzle");
const databaseUrl = process.env.DATABASE_URL ?? "file:./data/prizgram.sqlite";
const connection = createDatabase(databaseUrl);

try {
  migrateDatabase(connection, migrationsFolder);
  console.info("Database migrations applied.");
} finally {
  connection.close();
}
