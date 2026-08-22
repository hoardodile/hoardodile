import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core"
import { characters } from "src/domain/char/schema.ts"

/**
 * Domain table for {@link import("@hoardodile/schemas").Resource}. `content_plugin_id`
 * is the UUID of the content plugin that owns detection and preview.
 * `null` means no plugin has been assigned yet — detection runs when source
 * files are first uploaded.
 * Rebuildable metadata lives in {@link resourceMeta}. Tag and character
 * associations live in the `resource_tags` and `resource_characters` join
 * tables. Soft deletion is tracked via `deleted_at`.
 */
export const resources = sqliteTable(
	"resources",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		intro: text("intro").notNull().default(""),
		/**
		 * User-set provenance: display name of the origin (a site,
		 * platform, forum, or any other web page). Both source fields are
		 * optional; at least one is recommended so the origin stays
		 * discoverable.
		 */
		sourceName: text("source_name"),
		/** User-set provenance: external link to the origin page. */
		sourceUrl: text("source_url"),
		/**
		 * UUID of the content plugin that owns detection and preview for
		 * this resource. `null` means unassigned — detection runs on
		 * first source upload.
		 */
		contentPluginId: text("content_plugin_id"),
		/**
		 * Archive version where this resource's source files were created.
		 * Resources are immutable after creation, so this is
		 * effectively the resource's birth version.
		 */
		fileVersion: integer("file_version").notNull().default(1),
		/**
		 * Archive version where this resource's user-uploaded permanent
		 * `.cover.*` file lives. Bumped to `latestVersion` on every cover
		 * write/delete so covers remain mutable across version publishes,
		 * unlike the immutable source artifact tracked by `fileVersion`.
		 */
		coverVersion: integer("cover_version").notNull().default(1),

		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
		deletedAt: integer("deleted_at"),
	},
	(t) => [
		// Composite: the list/trash queries filter `deleted_at IS NULL/NOT
		// NULL` and order by `created_at` — a plain deleted_at index makes
		// them scan+sort every row (~3ms at 5k rows); the pair serves both
		// clauses from the index (~0.15ms, measured in bench/micro/db.bench.ts).
		index("resources_deleted_at_idx").on(t.deletedAt, t.createdAt),
		index("resources_created_at_idx").on(t.createdAt),
	],
)

/**
 * Rebuildable derived metadata for a resource. Kept separate from
 * {@link resources} so background meta rebuilds do not touch the user-owned
 * resource row or its `updatedAt`.
 */
export const resourceMeta = sqliteTable("resource_meta", {
	resourceId: text("resource_id")
		.primaryKey()
		.references(() => resources.id, { onDelete: "cascade" }),
	coverMeta: text("cover_meta"),
	sourceMeta: text("source_meta"),
	searchMeta: text("search_meta"),
	fileStats: text("file_stats"),
	/**
	 * Hash-rebuild state marker (`{"v":1}` once computed, `null` when the
	 * owning plugin produces no hashes or none were built yet). Kept
	 * separate from the hash rows so "computed, but legitimately empty"
	 * does not look like a missing rebuild.
	 */
	hashesMeta: text("hashes_meta"),
	/** Bumped whenever any meta column on this row changes. */
	builtAt: integer("built_at").notNull(),
})

/**
 * Per-file content hashes of a resource, produced by the owning plugin's
 * `imageHashes` hook. Exact hashes (`sha256`) back duplicate detection;
 * perceptual hashes (`dhash`/`phash`) back image similarity via Hamming
 * distance. Rows are fully replaced on every hash rebuild, so `pluginId`
 * and the value semantics stay aligned with the current plugin.
 */
export const resourceHashes = sqliteTable(
	"resource_hashes",
	{
		resourceId: text("resource_id")
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),
		/** Plugin that produced this hash row (rebuild tag). */
		pluginId: text("plugin_id").notNull(),
		/** Archive-relative file path the hash covers. */
		scope: text("scope").notNull(),
		/** Hash kind: `sha256` / `dhash` / `phash` or plugin-defined. */
		type: text("type").notNull(),
		/** Lowercase hex digest. */
		value: text("value").notNull(),
		/** Bit length of perceptual hashes (64 for dhash/phash). */
		bits: integer("bits"),
	},
	(t) => [
		primaryKey({ columns: [t.resourceId, t.pluginId, t.type, t.scope] }),
		// Exact-duplicate lookups filter by kind + value.
		index("resource_hashes_type_value_idx").on(t.type, t.value),
	],
)

/** Join table between resources and characters. Cascade on both sides. */
export const resCharacters = sqliteTable(
	"resource_characters",
	{
		resId: text("resource_id")
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),
		charId: text("character_id")
			.notNull()
			.references(() => characters.id, { onDelete: "cascade" }),
	},
	(t) => [primaryKey({ columns: [t.resId, t.charId] })],
)

/**
 * Dislike clicks on a resource, one row per click. Rows are deletable
 * only within `RESOURCE_DISLIKE_CANCEL_WINDOW_MS` of their `createdAt`;
 * after the window the dislike is permanent and every further click
 * appends another permanent row. The `(resource_id, created_at)` index
 * serves per-resource counts, latest-row lookups, and the 24h window
 * range scan for `dislikedRecently`.
 */
export const resourceDislikes = sqliteTable(
	"resource_dislikes",
	{
		id: text("id").primaryKey(),
		resourceId: text("resource_id")
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),
		createdAt: integer("created_at").notNull(),
	},
	(t) => [
		index("resource_dislikes_resource_idx").on(t.resourceId, t.createdAt),
	],
)
