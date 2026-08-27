CREATE TABLE `feedback_submissions_next` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL CHECK (`type` IN ('comment', 'review', 'suggestion', 'appeal')),
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'reviewed', 'appeal_accepted', 'rejected')),
	`submitted_by` text NOT NULL,
	`submitted_at` text NOT NULL,
	`moderated_by` text,
	`moderated_at` text,
	`subject_person_id` text,
	`subject_group` text
);
--> statement-breakpoint
INSERT INTO `feedback_submissions_next` (`id`, `type`, `body`, `status`, `submitted_by`, `submitted_at`, `moderated_by`, `moderated_at`, `subject_person_id`, `subject_group`)
SELECT `id`, `type`, `body`, CASE WHEN `status` = 'approved' THEN 'reviewed' ELSE `status` END, `submitted_by`, `submitted_at`, `moderated_by`, `moderated_at`, `subject_person_id`, `subject_group`
FROM `feedback_submissions`;
--> statement-breakpoint
DROP TABLE `feedback_submissions`;
--> statement-breakpoint
ALTER TABLE `feedback_submissions_next` RENAME TO `feedback_submissions`;
--> statement-breakpoint
CREATE INDEX `feedback_status_idx` ON `feedback_submissions` (`status`, `submitted_at`);
--> statement-breakpoint
CREATE INDEX `feedback_submitter_idx` ON `feedback_submissions` (`submitted_by`, `submitted_at`);
--> statement-breakpoint
CREATE INDEX `feedback_subject_idx` ON `feedback_submissions` (`subject_group`, `subject_person_id`, `submitted_at`);
