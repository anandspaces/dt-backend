CREATE TABLE `pyq_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`atom_id` text,
	`question_text` text NOT NULL,
	`metadata_json` text,
	`match_score` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`atom_id`) REFERENCES `atoms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `pyq_questions_file_id_idx` ON `pyq_questions` (`file_id`);--> statement-breakpoint
CREATE INDEX `pyq_questions_atom_id_idx` ON `pyq_questions` (`atom_id`);--> statement-breakpoint
ALTER TABLE `atoms` ADD `content_type` text;--> statement-breakpoint
ALTER TABLE `atoms` ADD `section_label` text;--> statement-breakpoint
ALTER TABLE `books` ADD `metadata_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `chapters` ADD `chapter_number` integer;--> statement-breakpoint
ALTER TABLE `chapters` ADD `page_start` integer;--> statement-breakpoint
ALTER TABLE `chapters` ADD `page_end` integer;--> statement-breakpoint
ALTER TABLE `chapters` ADD `metadata_json` text;--> statement-breakpoint
ALTER TABLE `files` ADD `ingestion_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `files` ADD `file_kind` text DEFAULT 'book' NOT NULL;