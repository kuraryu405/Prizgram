PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_application_stage_events` (
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
	CONSTRAINT "application_stage_events_sequence_positive" CHECK("__new_application_stage_events"."sequence" > 0),
	CONSTRAINT "application_stage_events_from_status_valid" CHECK("__new_application_stage_events"."from_status" is null or "__new_application_stage_events"."from_status" in ('saved','applying','submitted','screening','interview','offer','accepted','rejected','withdrawn','cancelled')),
	CONSTRAINT "application_stage_events_to_status_valid" CHECK("__new_application_stage_events"."to_status" in ('saved','applying','submitted','screening','interview','offer','accepted','rejected','withdrawn','cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_application_stage_events`("id", "user_id", "application_id", "sequence", "from_status", "to_status", "note", "occurred_at", "created_at") SELECT "id", "user_id", "application_id", "sequence", "from_status", "to_status", "note", "occurred_at", "created_at" FROM `application_stage_events`;--> statement-breakpoint
DROP TABLE `application_stage_events`;--> statement-breakpoint
ALTER TABLE `__new_application_stage_events` RENAME TO `application_stage_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `application_stage_events_sequence_unique` ON `application_stage_events` (`application_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `application_stage_events_user_occurred_idx` ON `application_stage_events` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `__new_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`job_version_id` text,
	`status` text DEFAULT 'saved' NOT NULL,
	`next_action` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`job_id`) REFERENCES `jobs`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`,`job_version_id`) REFERENCES `job_versions`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "applications_status_valid" CHECK("__new_applications"."status" in ('saved','applying','submitted','screening','interview','offer','accepted','rejected','withdrawn','cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_applications`("id", "user_id", "job_id", "job_version_id", "status", "next_action", "note", "created_at", "updated_at") SELECT "id", "user_id", "job_id", NULL, "status", "next_action", NULL, "created_at", "updated_at" FROM `applications`;--> statement-breakpoint
DROP TABLE `applications`;--> statement-breakpoint
ALTER TABLE `__new_applications` RENAME TO `applications`;--> statement-breakpoint
CREATE UNIQUE INDEX `applications_user_id_unique` ON `applications` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `applications_user_job_idx` ON `applications` (`user_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `applications_user_status_idx` ON `applications` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `applications_job_version_idx` ON `applications` (`job_version_id`);