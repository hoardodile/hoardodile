import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const contentPlugins = sqliteTable("content_plugins", {
	id: text("id").primaryKey(),
	manifest: text("manifest").notNull(),
	enabled: integer("enabled").notNull().default(1),
	priority: integer("priority").notNull(),
	pinned: integer("pinned").notNull().default(1),
	color: text("color").notNull().default(""),
	missing: integer("missing").notNull().default(0),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
})
