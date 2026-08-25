import type BetterSqlite3 from "better-sqlite3";

export type DatabaseTrigger = Readonly<{
  name: string;
  table: string;
  statement: string;
}>;

// Canonical trigger definitions. drizzle-kit snapshots cannot record SQLite
// triggers and table-rebuild migrations silently drop them, so these are
// re-applied idempotently after every migration.
export const databaseTriggers: ReadonlyArray<DatabaseTrigger> = [
  {
    name: "persona_versions_immutable",
    table: "persona_versions",
    statement: `CREATE TRIGGER IF NOT EXISTS \`persona_versions_immutable\`
BEFORE UPDATE ON \`persona_versions\`
BEGIN
	SELECT RAISE(ABORT, 'persona versions are immutable');
END`,
  },
  {
    name: "job_versions_immutable",
    table: "job_versions",
    statement: `CREATE TRIGGER IF NOT EXISTS \`job_versions_immutable\`
BEFORE UPDATE ON \`job_versions\`
BEGIN
	SELECT RAISE(ABORT, 'job versions are immutable');
END`,
  },
  {
    name: "users_updated_at",
    table: "users",
    statement: `CREATE TRIGGER IF NOT EXISTS \`users_updated_at\`
AFTER UPDATE ON \`users\`
WHEN NEW.\`updated_at\` = OLD.\`updated_at\`
BEGIN
	UPDATE \`users\` SET \`updated_at\` = max(unixepoch() * 1000, OLD.\`updated_at\` + 1) WHERE \`id\` = NEW.\`id\`;
END`,
  },
  {
    name: "jobs_updated_at",
    table: "jobs",
    statement: `CREATE TRIGGER IF NOT EXISTS \`jobs_updated_at\`
AFTER UPDATE ON \`jobs\`
WHEN NEW.\`updated_at\` = OLD.\`updated_at\`
BEGIN
	UPDATE \`jobs\` SET \`updated_at\` = max(unixepoch() * 1000, OLD.\`updated_at\` + 1) WHERE \`id\` = NEW.\`id\`;
END`,
  },
  {
    name: "applications_updated_at",
    table: "applications",
    statement: `CREATE TRIGGER IF NOT EXISTS \`applications_updated_at\`
AFTER UPDATE ON \`applications\`
WHEN NEW.\`updated_at\` = OLD.\`updated_at\`
BEGIN
	UPDATE \`applications\` SET \`updated_at\` = max(unixepoch() * 1000, OLD.\`updated_at\` + 1) WHERE \`id\` = NEW.\`id\`;
END`,
  },
  {
    name: "application_deadlines_updated_at",
    table: "application_deadlines",
    statement: `CREATE TRIGGER IF NOT EXISTS \`application_deadlines_updated_at\`
AFTER UPDATE ON \`application_deadlines\`
WHEN NEW.\`updated_at\` = OLD.\`updated_at\`
BEGIN
	UPDATE \`application_deadlines\` SET \`updated_at\` = max(unixepoch() * 1000, OLD.\`updated_at\` + 1) WHERE \`id\` = NEW.\`id\`;
END`,
  },
  {
    name: "reminders_updated_at",
    table: "reminders",
    statement: `CREATE TRIGGER IF NOT EXISTS \`reminders_updated_at\`
AFTER UPDATE ON \`reminders\`
WHEN NEW.\`updated_at\` = OLD.\`updated_at\`
BEGIN
	UPDATE \`reminders\` SET \`updated_at\` = max(unixepoch() * 1000, OLD.\`updated_at\` + 1) WHERE \`id\` = NEW.\`id\`;
END`,
  },
  {
    name: "user_credentials_updated_at",
    table: "user_credentials",
    statement: `CREATE TRIGGER IF NOT EXISTS \`user_credentials_updated_at\`
AFTER UPDATE ON \`user_credentials\`
WHEN NEW.\`updated_at\` = OLD.\`updated_at\`
BEGIN
	UPDATE \`user_credentials\` SET \`updated_at\` = max(unixepoch() * 1000, OLD.\`updated_at\` + 1) WHERE \`user_id\` = NEW.\`user_id\`;
END`,
  },
  {
    name: "users_delete_owned_data",
    table: "users",
    statement: `CREATE TRIGGER IF NOT EXISTS \`users_delete_owned_data\`
BEFORE DELETE ON \`users\`
BEGIN
	DELETE FROM \`reminders\` WHERE \`user_id\` = OLD.\`id\`;
	DELETE FROM \`application_deadlines\` WHERE \`user_id\` = OLD.\`id\`;
	DELETE FROM \`application_stage_events\` WHERE \`user_id\` = OLD.\`id\`;
	DELETE FROM \`applications\` WHERE \`user_id\` = OLD.\`id\`;
	DELETE FROM \`match_scores\` WHERE \`user_id\` = OLD.\`id\`;
	DELETE FROM \`job_versions\` WHERE \`user_id\` = OLD.\`id\`;
	DELETE FROM \`persona_versions\` WHERE \`user_id\` = OLD.\`id\`;
	DELETE FROM \`jobs\` WHERE \`user_id\` = OLD.\`id\`;
END`,
  },
];

export function ensureTriggers(sqlite: BetterSqlite3.Database): void {
  for (const { name, statement, table } of databaseTriggers) {
    const subjectTable = sqlite
      .prepare(
        "select 1 from sqlite_master where type = 'table' and name = ? limit 1",
      )
      .get(table);
    if (subjectTable === undefined) continue;
    if (
      sqlite
        .prepare(
          "select 1 from sqlite_master where type = 'trigger' and name = ? limit 1",
        )
        .get(name) === undefined
    ) {
      sqlite.prepare(statement).run();
    }
  }
}

export function listTriggerNames(sqlite: BetterSqlite3.Database): string[] {
  return (
    sqlite
      .prepare(
        "select name from sqlite_master where type = 'trigger' order by name",
      )
      .all() as Array<{ name: string }>
  ).map(({ name }) => name);
}
