ALTER TABLE `tags` ADD `link` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tags` ADD `image_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `tags` ADD `image_meta` text;