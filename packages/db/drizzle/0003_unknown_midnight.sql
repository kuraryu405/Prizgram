PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TRIGGER IF EXISTS `users_delete_owned_data`;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_kind` text,
	`source_external_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jobs_source_pair_consistency" CHECK(("__new_jobs"."source_kind" is null) = ("__new_jobs"."source_external_id" is null))
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "user_id", "source_kind", "source_external_id", "created_at", "updated_at") SELECT "id", "user_id", "source_kind", "source_external_id", "created_at", "updated_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_user_id_unique` ON `jobs` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_external_unique` ON `jobs` (`user_id`,`source_kind`,`source_external_id`);--> statement-breakpoint
CREATE INDEX `jobs_user_created_idx` ON `jobs` (`user_id`,`created_at`);