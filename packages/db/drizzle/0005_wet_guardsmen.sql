CREATE TABLE `persona_intake_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`intake_id` text NOT NULL,
	`question_id` text NOT NULL,
	`answer` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`intake_id`) REFERENCES `persona_intakes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "persona_intake_answers_question_shape" CHECK(length("persona_intake_answers"."question_id") between 1 and 64 and "persona_intake_answers"."question_id" not glob '*[^a-z0-9_]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `persona_intake_answers_question_unique` ON `persona_intake_answers` (`intake_id`,`question_id`);--> statement-breakpoint
CREATE INDEX `persona_intake_answers_user_idx` ON `persona_intake_answers` (`user_id`);--> statement-breakpoint
CREATE TABLE `persona_intakes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "persona_intakes_status_valid" CHECK("persona_intakes"."status" in ('in_progress','completed'))
);
--> statement-breakpoint
CREATE INDEX `persona_intakes_user_status_idx` ON `persona_intakes` (`user_id`,`status`);