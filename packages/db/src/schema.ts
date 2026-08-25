import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import {
  applicationStatuses,
  deadlineKinds,
  evidenceIdListSchema,
  generationProvenanceSchema,
  jobSnapshotSchema,
  personaSnapshotSchema,
  reminderPriorities,
  reminderStatuses,
  scoreReasonListSchema,
} from "@prizgram/shared";

import { validatedJsonText } from "./json-column";

const now = sql`(unixepoch() * 1000)`;
const personaSnapshotJson = validatedJsonText(
  "persona_versions.snapshot",
  personaSnapshotSchema,
);
const provenanceJson = validatedJsonText(
  "persona_versions.provenance",
  generationProvenanceSchema,
);
const jobSnapshotJson = validatedJsonText(
  "job_versions.snapshot",
  jobSnapshotSchema,
);
const scoreReasonsJson = validatedJsonText(
  "match_scores.reasons",
  scoreReasonListSchema,
);
const evidenceRefsJson = validatedJsonText(
  "match_scores.evidence_refs",
  evidenceIdListSchema,
);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(now),
});

export const userCredentials = sqliteTable(
  "user_credentials",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    loginId: text("login_id").notNull(),
    passwordHash: text("password_hash").notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (table) => [
    check(
      "user_credentials_login_id_normalized",
      sql`${table.loginId} = lower(${table.loginId})`,
    ),
    check(
      "user_credentials_login_id_shape",
      sql`length(${table.loginId}) between 3 and 64 and ${table.loginId} not glob '*[^a-z0-9._-]*'`,
    ),
    check(
      "user_credentials_password_hash_shape",
      sql`length(${table.passwordHash}) between 80 and 200 and ${table.passwordHash} like 'scrypt$%'`,
    ),
    check(
      "user_credentials_failed_attempts_nonnegative",
      sql`${table.failedAttempts} >= 0`,
    ),
    uniqueIndex("user_credentials_login_id_unique").on(table.loginId),
  ],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (table) => [
    check(
      "auth_sessions_token_hash_shape",
      sql`length(${table.tokenHash}) = 64 and ${table.tokenHash} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "auth_sessions_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expires_idx").on(table.expiresAt),
  ],
);

export const personaVersions = sqliteTable(
  "persona_versions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: personaSnapshotJson("snapshot").notNull(),
    provenance: provenanceJson("provenance").notNull(),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (table) => [
    check("persona_versions_version_positive", sql`${table.version} > 0`),
    check("persona_versions_snapshot_json", sql`json_valid(${table.snapshot})`),
    check(
      "persona_versions_provenance_json",
      sql`json_valid(${table.provenance})`,
    ),
    uniqueIndex("persona_versions_user_version_unique").on(
      table.userId,
      table.version,
    ),
    uniqueIndex("persona_versions_user_id_unique").on(table.userId, table.id),
    index("persona_versions_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind"),
    sourceExternalId: text("source_external_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (table) => [
    uniqueIndex("jobs_user_id_unique").on(table.userId, table.id),
    uniqueIndex("jobs_source_external_unique").on(
      table.userId,
      table.sourceKind,
      table.sourceExternalId,
    ),
    index("jobs_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const jobVersions = sqliteTable(
  "job_versions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: text("job_id").notNull(),
    version: integer("version").notNull(),
    snapshot: jobSnapshotJson("snapshot").notNull(),
    contentHash: text("content_hash").notNull(),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (table) => [
    check("job_versions_version_positive", sql`${table.version} > 0`),
    check("job_versions_snapshot_json", sql`json_valid(${table.snapshot})`),
    uniqueIndex("job_versions_job_version_unique").on(
      table.jobId,
      table.version,
    ),
    uniqueIndex("job_versions_user_id_unique").on(table.userId, table.id),
    uniqueIndex("job_versions_job_hash_unique").on(
      table.jobId,
      table.contentHash,
    ),
    index("job_versions_user_created_idx").on(table.userId, table.createdAt),
    foreignKey({
      columns: [table.userId, table.jobId],
      foreignColumns: [jobs.userId, jobs.id],
      name: "job_versions_owner_fk",
    }).onDelete("cascade"),
  ],
);

export const matchScores = sqliteTable(
  "match_scores",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    personaVersionId: text("persona_version_id").notNull(),
    jobVersionId: text("job_version_id").notNull(),
    skillFitScore: integer("skill_fit_score").notNull(),
    skillFitReasons: scoreReasonsJson("skill_fit_reasons").notNull(),
    skillFitEvidenceRefs: evidenceRefsJson("skill_fit_evidence_refs").notNull(),
    cultureValueFitScore: integer("culture_value_fit_score").notNull(),
    cultureValueFitReasons: scoreReasonsJson(
      "culture_value_fit_reasons",
    ).notNull(),
    cultureValueFitEvidenceRefs: evidenceRefsJson(
      "culture_value_fit_evidence_refs",
    ).notNull(),
    difficultyGapScore: integer("difficulty_gap_score").notNull(),
    difficultyGapReasons: scoreReasonsJson("difficulty_gap_reasons").notNull(),
    difficultyGapEvidenceRefs: evidenceRefsJson(
      "difficulty_gap_evidence_refs",
    ).notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (table) => [
    check(
      "match_scores_skill_range",
      sql`${table.skillFitScore} between 0 and 100`,
    ),
    check(
      "match_scores_culture_range",
      sql`${table.cultureValueFitScore} between 0 and 100`,
    ),
    check(
      "match_scores_difficulty_range",
      sql`${table.difficultyGapScore} between 0 and 100`,
    ),
    check(
      "match_scores_skill_reasons_json",
      sql`json_valid(${table.skillFitReasons})`,
    ),
    check(
      "match_scores_skill_evidence_json",
      sql`json_valid(${table.skillFitEvidenceRefs})`,
    ),
    check(
      "match_scores_culture_reasons_json",
      sql`json_valid(${table.cultureValueFitReasons})`,
    ),
    check(
      "match_scores_culture_evidence_json",
      sql`json_valid(${table.cultureValueFitEvidenceRefs})`,
    ),
    check(
      "match_scores_difficulty_reasons_json",
      sql`json_valid(${table.difficultyGapReasons})`,
    ),
    check(
      "match_scores_difficulty_evidence_json",
      sql`json_valid(${table.difficultyGapEvidenceRefs})`,
    ),
    foreignKey({
      columns: [table.userId, table.personaVersionId],
      foreignColumns: [personaVersions.userId, personaVersions.id],
      name: "match_scores_persona_owner_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.userId, table.jobVersionId],
      foreignColumns: [jobVersions.userId, jobVersions.id],
      name: "match_scores_job_owner_fk",
    }).onDelete("restrict"),
    uniqueIndex("match_scores_generation_unique").on(
      table.userId,
      table.personaVersionId,
      table.jobVersionId,
      table.model,
      table.promptVersion,
    ),
    index("match_scores_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const applications = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: text("job_id").notNull(),
    status: text("status", { enum: applicationStatuses })
      .notNull()
      .default("saved"),
    nextAction: text("next_action"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (table) => [
    check(
      "applications_status_valid",
      sql`${table.status} in ('saved','applying','submitted','screening','interview','offer','accepted','rejected','withdrawn')`,
    ),
    uniqueIndex("applications_user_id_unique").on(table.userId, table.id),
    uniqueIndex("applications_user_job_unique").on(table.userId, table.jobId),
    index("applications_user_status_idx").on(table.userId, table.status),
    foreignKey({
      columns: [table.userId, table.jobId],
      foreignColumns: [jobs.userId, jobs.id],
      name: "applications_job_owner_fk",
    }).onDelete("restrict"),
  ],
);

export const applicationStageEvents = sqliteTable(
  "application_stage_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    applicationId: text("application_id").notNull(),
    sequence: integer("sequence").notNull(),
    fromStatus: text("from_status", { enum: applicationStatuses }),
    toStatus: text("to_status", { enum: applicationStatuses }).notNull(),
    note: text("note"),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (table) => [
    check(
      "application_stage_events_sequence_positive",
      sql`${table.sequence} > 0`,
    ),
    check(
      "application_stage_events_from_status_valid",
      sql`${table.fromStatus} is null or ${table.fromStatus} in ('saved','applying','submitted','screening','interview','offer','accepted','rejected','withdrawn')`,
    ),
    check(
      "application_stage_events_to_status_valid",
      sql`${table.toStatus} in ('saved','applying','submitted','screening','interview','offer','accepted','rejected','withdrawn')`,
    ),
    uniqueIndex("application_stage_events_sequence_unique").on(
      table.applicationId,
      table.sequence,
    ),
    index("application_stage_events_user_occurred_idx").on(
      table.userId,
      table.occurredAt,
    ),
    foreignKey({
      columns: [table.userId, table.applicationId],
      foreignColumns: [applications.userId, applications.id],
      name: "application_stage_events_owner_fk",
    }).onDelete("cascade"),
  ],
);

export const applicationDeadlines = sqliteTable(
  "application_deadlines",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    applicationId: text("application_id").notNull(),
    kind: text("kind", { enum: deadlineKinds }).notNull(),
    title: text("title").notNull(),
    dueAt: integer("due_at", { mode: "timestamp_ms" }).notNull(),
    timezone: text("timezone").notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (table) => [
    check(
      "application_deadlines_kind_valid",
      sql`${table.kind} in ('application','document','interview','offer_response','other')`,
    ),
    uniqueIndex("application_deadlines_user_id_unique").on(
      table.userId,
      table.id,
    ),
    index("application_deadlines_application_due_idx").on(
      table.applicationId,
      table.dueAt,
    ),
    index("application_deadlines_user_due_idx").on(table.userId, table.dueAt),
    foreignKey({
      columns: [table.userId, table.applicationId],
      foreignColumns: [applications.userId, applications.id],
      name: "application_deadlines_owner_fk",
    }).onDelete("cascade"),
  ],
);

export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deadlineId: text("deadline_id").notNull(),
    scheduledFor: integer("scheduled_for", { mode: "timestamp_ms" }).notNull(),
    priority: text("priority", { enum: reminderPriorities }).notNull(),
    status: text("status", { enum: reminderStatuses })
      .notNull()
      .default("pending"),
    message: text("message").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    dismissedAt: integer("dismissed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (table) => [
    check(
      "reminders_attempt_count_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "reminders_priority_valid",
      sql`${table.priority} in ('low','medium','high','urgent')`,
    ),
    check(
      "reminders_status_valid",
      sql`${table.status} in ('pending','sent','dismissed','failed')`,
    ),
    uniqueIndex("reminders_user_id_unique").on(table.userId, table.id),
    uniqueIndex("reminders_dedupe_unique").on(table.userId, table.dedupeKey),
    index("reminders_pending_schedule_idx").on(
      table.status,
      table.scheduledFor,
    ),
    foreignKey({
      columns: [table.userId, table.deadlineId],
      foreignColumns: [applicationDeadlines.userId, applicationDeadlines.id],
      name: "reminders_deadline_owner_fk",
    }).onDelete("cascade"),
  ],
);

export const schema = {
  users,
  userCredentials,
  authSessions,
  personaVersions,
  jobs,
  jobVersions,
  matchScores,
  applications,
  applicationStageEvents,
  applicationDeadlines,
  reminders,
};

export const tableNames = [
  "users",
  "user_credentials",
  "auth_sessions",
  "persona_versions",
  "jobs",
  "job_versions",
  "match_scores",
  "applications",
  "application_stage_events",
  "application_deadlines",
  "reminders",
] as const;
