ALTER TABLE `jobs` ADD `archived_at` integer;
--> statement-breakpoint
CREATE INDEX `jobs_user_archived_idx` ON `jobs` (`user_id`,`archived_at`);
