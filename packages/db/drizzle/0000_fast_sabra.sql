CREATE TABLE `application_deadlines` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`application_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`due_at` integer NOT NULL,
	`timezone` text NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`application_id`) REFERENCES `applications`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "application_deadlines_kind_valid" CHECK("application_deadlines"."kind" in ('application','document','interview','offer_response','other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_deadlines_user_id_unique` ON `application_deadlines` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `application_deadlines_application_due_idx` ON `application_deadlines` (`application_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `application_deadlines_user_due_idx` ON `application_deadlines` (`user_id`,`due_at`);--> statement-breakpoint
CREATE TABLE `application_stage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`application_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`note` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`application_id`) REFERENCES `applications`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "application_stage_events_sequence_positive" CHECK("application_stage_events"."sequence" > 0),
	CONSTRAINT "application_stage_events_from_status_valid" CHECK("application_stage_events"."from_status" is null or "application_stage_events"."from_status" in ('saved','applying','submitted','screening','interview','offer','accepted','rejected','withdrawn')),
	CONSTRAINT "application_stage_events_to_status_valid" CHECK("application_stage_events"."to_status" in ('saved','applying','submitted','screening','interview','offer','accepted','rejected','withdrawn'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_stage_events_sequence_unique` ON `application_stage_events` (`application_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `application_stage_events_user_occurred_idx` ON `application_stage_events` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`status` text DEFAULT 'saved' NOT NULL,
	`next_action` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`job_id`) REFERENCES `jobs`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "applications_status_valid" CHECK("applications"."status" in ('saved','applying','submitted','screening','interview','offer','accepted','rejected','withdrawn'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_user_id_unique` ON `applications` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `applications_user_job_unique` ON `applications` (`user_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `applications_user_status_idx` ON `applications` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `job_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`job_id`) REFERENCES `jobs`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "job_versions_version_positive" CHECK("job_versions"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_versions_job_version_unique` ON `job_versions` (`job_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_versions_user_id_unique` ON `job_versions` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_versions_job_hash_unique` ON `job_versions` (`job_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `job_versions_user_created_idx` ON `job_versions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_kind` text,
	`source_external_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_user_id_unique` ON `jobs` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_external_unique` ON `jobs` (`user_id`,`source_kind`,`source_external_id`);--> statement-breakpoint
CREATE INDEX `jobs_user_created_idx` ON `jobs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `match_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`persona_version_id` text NOT NULL,
	`job_version_id` text NOT NULL,
	`skill_fit_score` integer NOT NULL,
	`skill_fit_reasons` text NOT NULL,
	`skill_fit_evidence_refs` text NOT NULL,
	`culture_value_fit_score` integer NOT NULL,
	`culture_value_fit_reasons` text NOT NULL,
	`culture_value_fit_evidence_refs` text NOT NULL,
	`difficulty_gap_score` integer NOT NULL,
	`difficulty_gap_reasons` text NOT NULL,
	`difficulty_gap_evidence_refs` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`persona_version_id`) REFERENCES `persona_versions`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`,`job_version_id`) REFERENCES `job_versions`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "match_scores_skill_range" CHECK("match_scores"."skill_fit_score" between 0 and 100),
	CONSTRAINT "match_scores_culture_range" CHECK("match_scores"."culture_value_fit_score" between 0 and 100),
	CONSTRAINT "match_scores_difficulty_range" CHECK("match_scores"."difficulty_gap_score" between 0 and 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_scores_generation_unique` ON `match_scores` (`user_id`,`persona_version_id`,`job_version_id`,`model`,`prompt_version`);--> statement-breakpoint
CREATE INDEX `match_scores_user_created_idx` ON `match_scores` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `persona_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot` text NOT NULL,
	`provenance` text NOT NULL,
	`model` text,
	`prompt_version` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "persona_versions_version_positive" CHECK("persona_versions"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `persona_versions_user_version_unique` ON `persona_versions` (`user_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `persona_versions_user_id_unique` ON `persona_versions` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `persona_versions_user_created_idx` ON `persona_versions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `persona_versions_immutable`
BEFORE UPDATE ON `persona_versions`
BEGIN
	SELECT RAISE(ABORT, 'persona versions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `job_versions_immutable`
BEFORE UPDATE ON `job_versions`
BEGIN
	SELECT RAISE(ABORT, 'job versions are immutable');
END;--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deadline_id` text NOT NULL,
	`scheduled_for` integer NOT NULL,
	`priority` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`message` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error_code` text,
	`sent_at` integer,
	`dismissed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`deadline_id`) REFERENCES `application_deadlines`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reminders_attempt_count_nonnegative" CHECK("reminders"."attempt_count" >= 0),
	CONSTRAINT "reminders_priority_valid" CHECK("reminders"."priority" in ('low','medium','high','urgent')),
	CONSTRAINT "reminders_status_valid" CHECK("reminders"."status" in ('pending','sent','dismissed','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminders_user_id_unique` ON `reminders` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reminders_dedupe_unique` ON `reminders` (`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `reminders_pending_schedule_idx` ON `reminders` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);--> statement-breakpoint
CREATE TRIGGER `users_delete_owned_data`
BEFORE DELETE ON `users`
BEGIN
	DELETE FROM `reminders` WHERE `user_id` = OLD.`id`;
	DELETE FROM `application_deadlines` WHERE `user_id` = OLD.`id`;
	DELETE FROM `application_stage_events` WHERE `user_id` = OLD.`id`;
	DELETE FROM `applications` WHERE `user_id` = OLD.`id`;
	DELETE FROM `match_scores` WHERE `user_id` = OLD.`id`;
	DELETE FROM `job_versions` WHERE `user_id` = OLD.`id`;
	DELETE FROM `persona_versions` WHERE `user_id` = OLD.`id`;
	DELETE FROM `jobs` WHERE `user_id` = OLD.`id`;
END;
