CREATE TABLE `auth` (
	`singleton` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`password_hash` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`intro` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`intro` text DEFAULT '' NOT NULL,
	`trait_values` text DEFAULT '{}' NOT NULL,
	`avatar_version` integer DEFAULT 1 NOT NULL,
	`fullbody_version` integer DEFAULT 1 NOT NULL,
	`image_meta` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `characters_deleted_at_idx` ON `characters` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `characters_created_at_idx` ON `characters` (`created_at`);--> statement-breakpoint
CREATE TABLE `characterships` (
	`id` text PRIMARY KEY NOT NULL,
	`type_id` text NOT NULL,
	`self_id` text,
	`target_id` text,
	`external_name` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`type_id`) REFERENCES `relationship_types`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`self_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "characterships_no_self_loop" CHECK("characterships"."self_id" IS NULL OR "characterships"."target_id" IS NULL OR "characterships"."self_id" != "characterships"."target_id"),
	CONSTRAINT "characterships_endpoint_xor_external" CHECK((
				("characterships"."self_id" IS NOT NULL AND "characterships"."target_id" IS NOT NULL AND "characterships"."external_name" = '')
				OR
				(
					(("characterships"."self_id" IS NOT NULL AND "characterships"."target_id" IS NULL) OR ("characterships"."self_id" IS NULL AND "characterships"."target_id" IS NOT NULL))
					AND length("characterships"."external_name") > 0
				)
			))
);
--> statement-breakpoint
CREATE INDEX `characterships_self_id_idx` ON `characterships` (`self_id`);--> statement-breakpoint
CREATE INDEX `characterships_target_id_idx` ON `characterships` (`target_id`);--> statement-breakpoint
CREATE TABLE `relationship_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`self_label` text DEFAULT '' NOT NULL,
	`target_label` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'directed' NOT NULL,
	`hierarchy_from` text,
	`position` integer DEFAULT 0 NOT NULL,
	`intro` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `relationship_types_position_idx` ON `relationship_types` (`position`);--> statement-breakpoint
CREATE TABLE `resource_collection_items` (
	`collection_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `resource_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `resource_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `resource_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`intro` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `comment_characters` (
	`comment_id` text NOT NULL,
	`character_id` text NOT NULL,
	PRIMARY KEY(`comment_id`, `character_id`),
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_characters_character_idx` ON `comment_characters` (`character_id`);--> statement-breakpoint
CREATE TABLE `comment_resources` (
	`comment_id` text NOT NULL,
	`resource_id` text NOT NULL,
	PRIMARY KEY(`comment_id`, `resource_id`),
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_resources_resource_idx` ON `comment_resources` (`resource_id`);--> statement-breakpoint
CREATE TABLE `comment_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_votes_comment_idx` ON `comment_votes` (`comment_id`);--> statement-breakpoint
CREATE INDEX `comment_votes_kind_idx` ON `comment_votes` (`comment_id`,`kind`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	`floor` integer,
	`anchor_resource_id` text,
	`anchor_data` text,
	FOREIGN KEY (`parent_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`anchor_resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comments_parent_id_idx` ON `comments` (`parent_id`);--> statement-breakpoint
CREATE INDEX `comments_created_at_idx` ON `comments` (`created_at`);--> statement-breakpoint
CREATE INDEX `comments_deleted_at_idx` ON `comments` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `comments_anchor_resource_idx` ON `comments` (`anchor_resource_id`);--> statement-breakpoint
CREATE TABLE `danmakus` (
	`id` text PRIMARY KEY NOT NULL,
	`anchor_resource_id` text NOT NULL,
	`anchor_data` text NOT NULL,
	`text` text NOT NULL,
	`color` text DEFAULT '' NOT NULL,
	`mode` text DEFAULT 'scroll' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`anchor_resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `danmakus_anchor_resource_idx` ON `danmakus` (`anchor_resource_id`);--> statement-breakpoint
CREATE TABLE `document_char_links` (
	`doc_id` text NOT NULL,
	`char_id` text NOT NULL,
	PRIMARY KEY(`doc_id`, `char_id`),
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `document_char_links_char_idx` ON `document_char_links` (`char_id`);--> statement-breakpoint
CREATE TABLE `document_res_links` (
	`doc_id` text NOT NULL,
	`res_id` text NOT NULL,
	PRIMARY KEY(`doc_id`, `res_id`),
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `document_res_links_res_idx` ON `document_res_links` (`res_id`);--> statement-breakpoint
CREATE TABLE `document_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`title` text NOT NULL,
	`content_blob` blob NOT NULL,
	`char_ids` text DEFAULT '[]' NOT NULL,
	`res_ids` text DEFAULT '[]' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_versions_doc_no_idx` ON `document_versions` (`doc_id`,`version_no`);--> statement-breakpoint
CREATE INDEX `document_versions_doc_idx` ON `document_versions` (`doc_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`draft_title` text,
	`draft_content_blob` blob,
	`draft_char_ids` text DEFAULT '[]' NOT NULL,
	`draft_res_ids` text DEFAULT '[]' NOT NULL,
	`draft_updated_at` integer,
	`head_version_id` text,
	`search_text` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `documents_parent_position_idx` ON `documents` (`parent_id`,`position`);--> statement-breakpoint
CREATE INDEX `documents_deleted_at_idx` ON `documents` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `documents_kind_idx` ON `documents` (`kind`);--> statement-breakpoint
CREATE TABLE `content_plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`manifest` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`priority` integer NOT NULL,
	`pinned` integer DEFAULT 1 NOT NULL,
	`color` text DEFAULT '' NOT NULL,
	`missing` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plugin_cache` (
	`plugin_id` text NOT NULL,
	`res_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_cache_pkey` ON `plugin_cache` (`plugin_id`,`res_id`,`key`);--> statement-breakpoint
CREATE INDEX `plugin_cache_res_idx` ON `plugin_cache` (`plugin_id`,`res_id`);--> statement-breakpoint
CREATE TABLE `plugin_preferences` (
	`plugin_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`plugin_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `system_preferences` (
	`key` text PRIMARY KEY NOT NULL,
	`scope` text DEFAULT 'sync' NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `resource_characters` (
	`resource_id` text NOT NULL,
	`character_id` text NOT NULL,
	PRIMARY KEY(`resource_id`, `character_id`),
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `resource_dislikes` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `resource_dislikes_resource_idx` ON `resource_dislikes` (`resource_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `resource_hashes` (
	`resource_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`scope` text NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`bits` integer,
	PRIMARY KEY(`resource_id`, `plugin_id`, `type`, `scope`),
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `resource_hashes_type_value_idx` ON `resource_hashes` (`type`,`value`);--> statement-breakpoint
CREATE TABLE `resource_meta` (
	`resource_id` text PRIMARY KEY NOT NULL,
	`cover_meta` text,
	`source_meta` text,
	`search_meta` text,
	`file_stats` text,
	`hashes_meta` text,
	`built_at` integer NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`intro` text DEFAULT '' NOT NULL,
	`source_name` text,
	`source_url` text,
	`content_plugin_id` text,
	`file_version` integer DEFAULT 1 NOT NULL,
	`cover_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `resources_deleted_at_idx` ON `resources` (`deleted_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `resources_created_at_idx` ON `resources` (`created_at`);--> statement-breakpoint
CREATE TABLE `sync_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_records` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`resource_count` integer DEFAULT 0 NOT NULL,
	`character_count` integer DEFAULT 0 NOT NULL,
	`document_count` integer DEFAULT 0 NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`tag_count` integer DEFAULT 0 NOT NULL,
	`trash_count` integer DEFAULT 0 NOT NULL,
	`storage_bytes` integer DEFAULT 0 NOT NULL,
	`resource_bytes` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `sync_devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_records_device_recorded_at_idx` ON `sync_records` (`device_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `character_tags` (
	`character_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`character_id`, `tag_id`),
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `parent_rules` (
	`child_kind` text DEFAULT 'tag' NOT NULL,
	`child_id` text,
	`child_character_id` text,
	`parent_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`child_kind`, `child_id`, `child_character_id`, `parent_id`),
	FOREIGN KEY (`child_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "parent_rules_child_endpoint_exclusive" CHECK((
				("parent_rules"."child_kind" = 'tag' AND "parent_rules"."child_id" IS NOT NULL AND "parent_rules"."child_character_id" IS NULL)
				OR
				("parent_rules"."child_kind" = 'character' AND "parent_rules"."child_id" IS NULL AND "parent_rules"."child_character_id" IS NOT NULL)
			))
);
--> statement-breakpoint
CREATE TABLE `resource_tags` (
	`resource_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`resource_id`, `tag_id`),
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sibling_pairs` (
	`bad_kind` text DEFAULT 'tag' NOT NULL,
	`bad_id` text,
	`bad_character_id` text,
	`good_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`bad_kind`, `bad_id`, `bad_character_id`),
	FOREIGN KEY (`bad_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bad_character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`good_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sibling_pairs_endpoint_exclusive" CHECK((
				("sibling_pairs"."bad_kind" = 'tag' AND "sibling_pairs"."bad_id" IS NOT NULL AND "sibling_pairs"."bad_character_id" IS NULL)
				OR
				("sibling_pairs"."bad_kind" = 'character' AND "sibling_pairs"."bad_id" IS NULL AND "sibling_pairs"."bad_character_id" IS NOT NULL)
			))
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`intro` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`category_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_category_name_unique` ON `tags` (`category_id`,`name`);--> statement-breakpoint
CREATE TABLE `user_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_name` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`platform` text DEFAULT 'web-pc' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_actions_created_at_idx` ON `user_actions` (`created_at`);--> statement-breakpoint
CREATE INDEX `user_actions_entity_idx` ON `user_actions` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `trait_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`color` text DEFAULT '' NOT NULL,
	`intro` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trait_defs_name_unique` ON `trait_defs` (`name`);--> statement-breakpoint
CREATE INDEX `trait_defs_position_idx` ON `trait_defs` (`position`);--> statement-breakpoint
CREATE TABLE `usage_session_associations` (
	`session_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`association_kind` text NOT NULL,
	PRIMARY KEY(`session_id`, `entity_type`, `entity_id`)
);
--> statement-breakpoint
CREATE INDEX `usage_session_associations_entity_idx` ON `usage_session_associations` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `usage_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`platform` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_sessions_entity_idx` ON `usage_sessions` (`entity_type`,`entity_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `usage_sessions_started_idx` ON `usage_sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `usage_sessions_ended_idx` ON `usage_sessions` (`ended_at`);--> statement-breakpoint
CREATE TABLE `migration_runs` (
	`name` text PRIMARY KEY NOT NULL,
	`ran_at` integer NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL
);
