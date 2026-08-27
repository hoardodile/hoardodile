import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const contentPlugins = sqliteTable("content_plugins", {
	id: text("id").primaryKey(),
	manifest: text("manifest").notNull(),
	enabled: integer("enabled").notNull().default(1),
	priority: integer("priority").notNull(),
	pinned: integer("pinned").notNull().default(1),
	color: text("color").notNull().default(""),
	missing: integer("missing").notNull().default(0),
	/**
	 * Normalized `owner/repo` the plugin was installed from via the
	 * marketplace. The update source remembered across registry switches:
	 * the snapshot merges installed plugins whose source repo is no longer
	 * listed by the current registry, so their updates stay detectable.
	 * `NULL` for plugins installed from a zip or bundled (seed) plugins.
	 */
	sourceRepo: text("source_repo"),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
})
