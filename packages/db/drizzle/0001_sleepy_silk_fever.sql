DROP TRIGGER `users_delete_owned_data`;--> statement-breakpoint
DROP TRIGGER `persona_versions_immutable`;--> statement-breakpoint
DROP TRIGGER `job_versions_immutable`;--> statement-breakpoint
CREATE TABLE `__new_job_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`job_id`) REFERENCES `jobs`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "job_versions_version_positive" CHECK("__new_job_versions"."version" > 0),
	CONSTRAINT "job_versions_snapshot_json" CHECK(json_valid("__new_job_versions"."snapshot"))
);
--> statement-breakpoint
INSERT INTO `__new_job_versions`("id", "user_id", "job_id", "version", "snapshot", "content_hash", "created_at") SELECT "id", "user_id", "job_id", "version", "snapshot", "content_hash", "created_at" FROM `job_versions`;--> statement-breakpoint
DROP TABLE `job_versions`;--> statement-breakpoint
ALTER TABLE `__new_job_versions` RENAME TO `job_versions`;--> statement-breakpoint
CREATE UNIQUE INDEX `job_versions_job_version_unique` ON `job_versions` (`job_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_versions_user_id_unique` ON `job_versions` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_versions_job_hash_unique` ON `job_versions` (`job_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `job_versions_user_created_idx` ON `job_versions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_match_scores` (
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
	CONSTRAINT "match_scores_skill_range" CHECK("__new_match_scores"."skill_fit_score" between 0 and 100),
	CONSTRAINT "match_scores_culture_range" CHECK("__new_match_scores"."culture_value_fit_score" between 0 and 100),
	CONSTRAINT "match_scores_difficulty_range" CHECK("__new_match_scores"."difficulty_gap_score" between 0 and 100),
	CONSTRAINT "match_scores_skill_reasons_json" CHECK(json_valid("__new_match_scores"."skill_fit_reasons")),
	CONSTRAINT "match_scores_skill_evidence_json" CHECK(json_valid("__new_match_scores"."skill_fit_evidence_refs")),
	CONSTRAINT "match_scores_culture_reasons_json" CHECK(json_valid("__new_match_scores"."culture_value_fit_reasons")),
	CONSTRAINT "match_scores_culture_evidence_json" CHECK(json_valid("__new_match_scores"."culture_value_fit_evidence_refs")),
	CONSTRAINT "match_scores_difficulty_reasons_json" CHECK(json_valid("__new_match_scores"."difficulty_gap_reasons")),
	CONSTRAINT "match_scores_difficulty_evidence_json" CHECK(json_valid("__new_match_scores"."difficulty_gap_evidence_refs"))
);
--> statement-breakpoint
INSERT INTO `__new_match_scores`("id", "user_id", "persona_version_id", "job_version_id", "skill_fit_score", "skill_fit_reasons", "skill_fit_evidence_refs", "culture_value_fit_score", "culture_value_fit_reasons", "culture_value_fit_evidence_refs", "difficulty_gap_score", "difficulty_gap_reasons", "difficulty_gap_evidence_refs", "model", "prompt_version", "created_at") SELECT "id", "user_id", "persona_version_id", "job_version_id", "skill_fit_score", "skill_fit_reasons", "skill_fit_evidence_refs", "culture_value_fit_score", "culture_value_fit_reasons", "culture_value_fit_evidence_refs", "difficulty_gap_score", "difficulty_gap_reasons", "difficulty_gap_evidence_refs", "model", "prompt_version", "created_at" FROM `match_scores`;--> statement-breakpoint
DROP TABLE `match_scores`;--> statement-breakpoint
ALTER TABLE `__new_match_scores` RENAME TO `match_scores`;--> statement-breakpoint
CREATE UNIQUE INDEX `match_scores_generation_unique` ON `match_scores` (`user_id`,`persona_version_id`,`job_version_id`,`model`,`prompt_version`);--> statement-breakpoint
CREATE INDEX `match_scores_user_created_idx` ON `match_scores` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_persona_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot` text NOT NULL,
	`provenance` text NOT NULL,
	`model` text,
	`prompt_version` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "persona_versions_version_positive" CHECK("__new_persona_versions"."version" > 0),
	CONSTRAINT "persona_versions_snapshot_json" CHECK(json_valid("__new_persona_versions"."snapshot")),
	CONSTRAINT "persona_versions_provenance_json" CHECK(json_valid("__new_persona_versions"."provenance"))
);
--> statement-breakpoint
INSERT INTO `__new_persona_versions`("id", "user_id", "version", "snapshot", "provenance", "model", "prompt_version", "created_at") SELECT "id", "user_id", "version", "snapshot", "provenance", "model", "prompt_version", "created_at" FROM `persona_versions`;--> statement-breakpoint
DROP TABLE `persona_versions`;--> statement-breakpoint
ALTER TABLE `__new_persona_versions` RENAME TO `persona_versions`;--> statement-breakpoint
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
CREATE TRIGGER `users_updated_at`
AFTER UPDATE ON `users`
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `users` SET `updated_at` = max(unixepoch() * 1000, OLD.`updated_at` + 1) WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `jobs_updated_at`
AFTER UPDATE ON `jobs`
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `jobs` SET `updated_at` = max(unixepoch() * 1000, OLD.`updated_at` + 1) WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `applications_updated_at`
AFTER UPDATE ON `applications`
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `applications` SET `updated_at` = max(unixepoch() * 1000, OLD.`updated_at` + 1) WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `application_deadlines_updated_at`
AFTER UPDATE ON `application_deadlines`
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `application_deadlines` SET `updated_at` = max(unixepoch() * 1000, OLD.`updated_at` + 1) WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `reminders_updated_at`
AFTER UPDATE ON `reminders`
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `reminders` SET `updated_at` = max(unixepoch() * 1000, OLD.`updated_at` + 1) WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
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
