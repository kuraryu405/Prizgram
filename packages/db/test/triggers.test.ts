import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabase,
  databaseTriggers,
  listTriggerNames,
  migrateDatabase,
  type DatabaseConnection,
} from "../src";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../drizzle");

let temporaryDirectory: string;
let connection: DatabaseConnection;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "prizgram-triggers-test-"),
  );
  connection = createDatabase(path.join(temporaryDirectory, "triggers.sqlite"));
  migrateDatabase(connection, migrationsFolder);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("database triggers", () => {
  it("applies every canonical trigger after migration", () => {
    const names = listTriggerNames(connection.sqlite);
    for (const { name } of databaseTriggers) {
      expect(names).toContain(name);
    }
    expect(names).toHaveLength(databaseTriggers.length);
  });

  it("restores triggers dropped by a table-rebuild migration", () => {
    for (const { name } of databaseTriggers) {
      connection.sqlite.prepare(`drop trigger if exists \`${name}\``).run();
    }
    expect(listTriggerNames(connection.sqlite)).toHaveLength(0);

    migrateDatabase(connection, migrationsFolder);

    const names = listTriggerNames(connection.sqlite);
    for (const { name } of databaseTriggers) {
      expect(names).toContain(name);
    }
  });
});
