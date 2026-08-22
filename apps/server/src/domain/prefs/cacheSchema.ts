import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core"

/**
 * Per-plugin, per-resource cache store.
 *
 * This is intentionally separate from `user_preferences` because layer-3
 * data (plugin + resId scoped) can grow unbounded and is treated as
 * cache rather than persistent preference. Structured columns let us
 * query and evict efficiently.
 */
export const pluginCache = sqliteTable(
	"plugin_cache",
	{
		pluginId: text("plugin_id").notNull(),
		resId: text("res_id").notNull(),
		key: text("key").notNull(),
		value: text("value").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("plugin_cache_pkey").on(table.pluginId, table.resId, table.key),
		index("plugin_cache_res_idx").on(table.pluginId, table.resId),
	],
)
