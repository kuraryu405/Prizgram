import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDatabase,
  databaseUrlFromEnvironment,
  loadPrizgramEnvironment,
  migrateDatabase,
} from "./client";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(currentDirectory, "../drizzle");
loadPrizgramEnvironment();
const connection = createDatabase(databaseUrlFromEnvironment());

try {
  migrateDatabase(connection, migrationsFolder);
  console.info("Database migrations applied.");
} finally {
  connection.close();
}
