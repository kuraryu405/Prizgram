PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	CONSTRAINT "applications_status_valid" CHECK("__new_applications"."status" in ('saved','applying','submitted','screening','interview','offer','accepted','rejected','withdrawn'))
);
--> statement-breakpoint
INSERT INTO `__new_applications`("id", "user_id", "job_id", "job_version_id", "status", "next_action", "note", "created_at", "updated_at") SELECT "id", "user_id", "job_id", NULL, "status", "next_action", NULL, "created_at", "updated_at" FROM `applications`;--> statement-breakpoint
DROP TABLE `applications`;--> statement-breakpoint
ALTER TABLE `__new_applications` RENAME TO `applications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `applications_user_id_unique` ON `applications` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `applications_user_job_unique` ON `applications` (`user_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `applications_user_status_idx` ON `applications` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `applications_job_version_idx` ON `applications` (`job_version_id`);