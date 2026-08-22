import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { resources } from "src/domain/res/schema.ts"

/**
 * Domain table for {@link import("@hoardodile/schemas").Danmaku}.
 *
 * Append-only bullet comments anchored to a resource. Rows cascade-delete
 * when their parent resource is removed. The plugin location payload is
 * stored as JSON in `anchor_data`; the resource id lives in its own
 * column.
 */
export const danmakus = sqliteTable(
	"danmakus",
	{
		id: text("id").primaryKey(),
		anchorResourceId: text("anchor_resource_id")
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),
		/** Plugin location payload (`{"data": ...}`). */
		anchorData: text("anchor_data").notNull(),
		text: text("text").notNull(),
		color: text("color").notNull().default(""),
		mode: text("mode", { enum: ["scroll", "top", "bottom"] })
			.notNull()
			.default("scroll"),
		createdAt: integer("created_at").notNull(),
	},
	(t) => [index("danmakus_anchor_resource_idx").on(t.anchorResourceId)],
)
