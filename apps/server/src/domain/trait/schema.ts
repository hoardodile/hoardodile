import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * Definition table for character traits. A trait is a named, typed field
 * that characters can carry values for. The `kind` column determines how
 * the raw string stored in `characters.trait_values` is parsed and sorted.
 * Trait names are globally unique so UI labels are unambiguous.
 */
export const traitDefs = sqliteTable(
	"trait_defs",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull().unique(),
		kind: text("kind", {
			enum: ["text", "multitext", "number", "height", "weight", "date"],
		}).notNull(),
		position: integer("position").notNull().default(0),
		pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
		color: text("color").notNull().default(""),
		intro: text("intro").notNull().default(""),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(t) => [index("trait_defs_position_idx").on(t.position)],
)
