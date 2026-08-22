import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * System-level key/value preference store.
 *
 * `key` is opaque to the server: callers namespace their keys with a
 * stable prefix (e.g. `theme`, `document.zoom`). `value` is a JSON-
 * encoded payload so we can store strings, numbers, and small objects
 * without per-shape tables. The server never decodes `value`; it is
 * round-tripped verbatim.
 */
export const systemPreferences = sqliteTable("system_preferences", {
	key: text("key").primaryKey(),
	scope: text("scope").notNull().default("sync"),
	value: text("value").notNull(),
	updatedAt: integer("updated_at").notNull(),
})

/**
 * Plugin-scoped key/value preference store.
 *
 * Structured columns let us query and manage plugin data separately
 * from system prefs. Keys are plugin-local (no prefix needed).
 */
export const pluginPreferences = sqliteTable(
	"plugin_preferences",
	{
		pluginId: text("plugin_id").notNull(),
		key: text("key").notNull(),
		value: text("value").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [primaryKey({ columns: [table.pluginId, table.key] })],
)
