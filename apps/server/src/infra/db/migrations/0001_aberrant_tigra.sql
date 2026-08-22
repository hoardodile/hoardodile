CREATE TABLE `auth_sign_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`ip` text NOT NULL,
	`origin` text NOT NULL,
	`device_label` text NOT NULL,
	`recorded_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_sign_ins_recorded_idx` ON `auth_sign_ins` (`recorded_at`);--> statement-breakpoint
ALTER TABLE `auth` ADD `weak_password` integer DEFAULT 0 NOT NULL;