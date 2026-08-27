ALTER TABLE `user_accounts` ADD `created_by` text;
--> statement-breakpoint
UPDATE `user_accounts` SET `role` = 'super_admin' WHERE `role` = 'admin';
--> statement-breakpoint
CREATE TABLE `feedback_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL CHECK (`type` IN ('comment', 'review', 'suggestion')),
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'approved', 'rejected')),
	`submitted_by` text NOT NULL,
	`submitted_at` text NOT NULL,
	`moderated_by` text,
	`moderated_at` text
);
--> statement-breakpoint
CREATE INDEX `feedback_status_idx` ON `feedback_submissions` (`status`, `submitted_at`);
--> statement-breakpoint
CREATE INDEX `feedback_submitter_idx` ON `feedback_submissions` (`submitted_by`, `submitted_at`);
