import {
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core"

/**
 * Domain table for {@link import("@hoardodile/schemas").Category} (the
 * user-visible "namespace"). Categories are flat: there is no parent/child
 * relationship. Hard-deleted only - there is no soft-delete lifecycle.
 * `name` is globally unique (trim, exact match) so the namespace set is
 * always unambiguous.
 */
export const categories = sqliteTable(
	"categories",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		intro: text("intro").notNull().default(""),
		color: text("color").notNull().default(""),
		kind: text("kind", {
			enum: ["common", "resource", "character"],
		}).notNull(),
		position: integer("position").notNull().default(0),
		pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	// Namespace names are globally unique. The first-run dedupe
	// (domain/tag/dedupe.ts) runs BEFORE migrations on pre-rewrite
	// databases so legacy duplicates cannot break index creation.
	(t) => [uniqueIndex("categories_name_unique").on(t.name)],
)
