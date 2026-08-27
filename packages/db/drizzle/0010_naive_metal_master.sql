CREATE TABLE `application_document_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`document_id` text NOT NULL,
	`question` text NOT NULL,
	`answer` text DEFAULT '' NOT NULL,
	`character_limit` integer,
	`ordering` integer DEFAULT 0 NOT NULL,
	`provenance` text DEFAULT 'edited' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`document_id`) REFERENCES `application_documents`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "application_document_entries_question_shape" CHECK(length("application_document_entries"."question") between 1 and 500),
	CONSTRAINT "application_document_entries_answer_limit" CHECK(length("application_document_entries"."answer") <= 20000),
	CONSTRAINT "application_document_entries_provenance_valid" CHECK("application_document_entries"."provenance" in ('generated','edited','submitted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_document_entries_user_id_unique` ON `application_document_entries` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `application_document_entries_document_ordering_idx` ON `application_document_entries` (`document_id`,`ordering`);--> statement-breakpoint
CREATE TABLE `application_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`application_id` text NOT NULL,
	`type` text DEFAULT 'es' NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`submitted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`application_id`) REFERENCES `applications`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "application_documents_type_valid" CHECK("application_documents"."type" in ('es','cv','other')),
	CONSTRAINT "application_documents_status_valid" CHECK("application_documents"."status" in ('draft','generated','edited','submitted')),
	CONSTRAINT "application_documents_submitted_at_required" CHECK(("application_documents"."status" != 'submitted') or ("application_documents"."submitted_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_documents_user_id_unique` ON `application_documents` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `application_documents_user_application_idx` ON `application_documents` (`user_id`,`application_id`);--> statement-breakpoint
CREATE INDEX `application_documents_user_status_idx` ON `application_documents` (`user_id`,`status`);