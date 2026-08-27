CREATE TABLE `application_interview_reflections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`application_id` text NOT NULL,
	`stage_label` text,
	`questions_asked` text DEFAULT '[]' NOT NULL,
	`answer_notes` text DEFAULT '' NOT NULL,
	`impression` text,
	`feedback` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`application_id`) REFERENCES `applications`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "application_interview_reflections_questions_shape" CHECK(length("application_interview_reflections"."questions_asked") <= 20000),
	CONSTRAINT "application_interview_reflections_answer_shape" CHECK(length("application_interview_reflections"."answer_notes") <= 20000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_interview_reflections_user_id_unique` ON `application_interview_reflections` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `application_interview_reflections_application_idx` ON `application_interview_reflections` (`application_id`);--> statement-breakpoint
CREATE INDEX `application_interview_reflections_user_application_idx` ON `application_interview_reflections` (`user_id`,`application_id`);