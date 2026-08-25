import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  createDatabase,
  databaseUrlFromEnvironment,
  loadPrizgramEnvironment,
  migrateDatabase,
  ReminderService,
} from "@prizgram/db";

/**
 * Cron entrypoint for deterministic reminder generation.
 *
 * Usage: DATABASE_URL=file:... pnpm reminders:cron
 * Exits non-zero on any failure so the scheduler can alert operators.
 */
function main(): void {
  loadPrizgramEnvironment();
  const connection = createDatabase(databaseUrlFromEnvironment());
  try {
    // Ensure the schema exists even on a fresh volume before scanning.
    const migrationsFolder = fileURLToPath(
      new URL("../../../packages/db/drizzle/", import.meta.url),
    );
    migrateDatabase(connection, migrationsFolder);
    const summary = new ReminderService(connection.db).generateDueReminders({
      now: new Date(),
    });
    console.info(
      `Reminder scan finished: scanned=${summary.scanned} created=${summary.created}`,
    );
  } finally {
    connection.close();
  }
}

try {
  main();
} catch (error) {
  console.error(
    "Reminder scan failed:",
    error instanceof Error ? `${error.name}: ${error.message}` : error,
  );
  process.exit(1);
}
