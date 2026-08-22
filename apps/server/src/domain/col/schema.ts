import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { resources } from "src/domain/res/schema.ts"

/**
 * Domain table for {@link import("@hoardodile/schemas").ResCollection}.
 * Hard-deleted only (no soft-delete trash semantics).
 */
export const resCollections = sqliteTable("resource_collections", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	intro: text("intro").notNull().default(""),
	color: text("color").notNull().default(""),
	position: integer("position").notNull().default(0),
	pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
})

/**
 * Join table linking resources to collections. `position` stores the
 * resource's order within the collection (lower first); ties broken by
 * `created_at` then `resource_id`. Cascade on both sides.
 */
export const resCollectionItems = sqliteTable(
	"resource_collection_items",
	{
		colId: text("collection_id")
			.notNull()
			.references(() => resCollections.id, { onDelete: "cascade" }),
		resId: text("resource_id")
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),
		position: integer("position").notNull().default(0),
		createdAt: integer("created_at").notNull(),
	},
	(t) => [primaryKey({ columns: [t.colId, t.resId] })],
)
