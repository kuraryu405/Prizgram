#!/usr/bin/env node

import Database from "better-sqlite3";

const [sourceFile, backupFile] = process.argv.slice(2);

if (sourceFile === undefined || backupFile === undefined) {
  console.error("Usage: sqlite-backup.mjs <source-file> <backup-file>");
  process.exitCode = 2;
} else {
  let source;
  let backup;
  try {
    source = new Database(sourceFile, { fileMustExist: true, readonly: true });
    await source.backup(backupFile);

    backup = new Database(backupFile, { fileMustExist: true, readonly: true });
    const integrity = backup.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      throw new Error(`Backup integrity_check failed: ${String(integrity)}`);
    }
    console.log(`Backup verified: ${backupFile}`);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "SQLite backup failed",
    );
    process.exitCode = 1;
  } finally {
    backup?.close();
    source?.close();
  }
}
