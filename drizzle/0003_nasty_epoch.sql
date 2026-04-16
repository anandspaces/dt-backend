CREATE TABLE `atom_audio` (
	`id` text PRIMARY KEY NOT NULL,
	`atom_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`mime` text DEFAULT 'audio/mpeg' NOT NULL,
	`provider` text NOT NULL,
	`char_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`atom_id`) REFERENCES `atoms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `atom_audio_atom_id_unique` ON `atom_audio` (`atom_id`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`chapter_id` text NOT NULL,
	`title` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `topics_chapter_id_idx` ON `topics` (`chapter_id`);--> statement-breakpoint
ALTER TABLE `atoms` ADD `topic_id` text REFERENCES topics(id);--> statement-breakpoint
CREATE INDEX `atoms_topic_id_idx` ON `atoms` (`topic_id`);