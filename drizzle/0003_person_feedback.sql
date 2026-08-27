ALTER TABLE `feedback_submissions` ADD `subject_person_id` text;
--> statement-breakpoint
ALTER TABLE `feedback_submissions` ADD `subject_group` text;
--> statement-breakpoint
CREATE INDEX `feedback_subject_idx` ON `feedback_submissions` (`subject_group`, `subject_person_id`, `submitted_at`);
