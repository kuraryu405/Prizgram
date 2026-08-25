CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_sessions_token_hash_shape" CHECK(length("auth_sessions"."token_hash") = 64 and "auth_sessions"."token_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "auth_sessions_expiry_after_creation" CHECK("auth_sessions"."expires_at" > "auth_sessions"."created_at")
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`login_id` text NOT NULL,
	`password_hash` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_credentials_login_id_normalized" CHECK("user_credentials"."login_id" = lower("user_credentials"."login_id")),
	CONSTRAINT "user_credentials_login_id_shape" CHECK(length("user_credentials"."login_id") between 3 and 64 and "user_credentials"."login_id" not glob '*[^a-z0-9._-]*'),
	CONSTRAINT "user_credentials_password_hash_shape" CHECK(length("user_credentials"."password_hash") between 80 and 200 and "user_credentials"."password_hash" like 'scrypt$%'),
	CONSTRAINT "user_credentials_failed_attempts_nonnegative" CHECK("user_credentials"."failed_attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_credentials_login_id_unique` ON `user_credentials` (`login_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `user_credentials_updated_at`
AFTER UPDATE ON `user_credentials`
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `user_credentials` SET `updated_at` = max(unixepoch() * 1000, OLD.`updated_at` + 1) WHERE `user_id` = NEW.`user_id`;
END;
