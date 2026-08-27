ALTER TABLE `user_accounts` ADD `password_algorithm` text DEFAULT 'pbkdf2-sha256' NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_accounts` ADD `password_iterations` integer DEFAULT 310000 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_accounts` ADD `credential_version` text DEFAULT '1' NOT NULL;
--> statement-breakpoint
CREATE TABLE `application_snapshot` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	CONSTRAINT `application_snapshot_singleton` CHECK (`id` = 1)
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`entity_id` text,
	`action` text NOT NULL,
	`before_value` text,
	`after_value` text,
	`actor` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_revision_idx` ON `audit_events` (`revision`);
--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`category`,`entity_id`);
--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`failure_count` integer NOT NULL,
	`window_started_at` integer NOT NULL,
	`locked_until` integer NOT NULL
);
--> statement-breakpoint
DELETE FROM `user_sessions`;
--> statement-breakpoint
DELETE FROM `user_accounts`;
