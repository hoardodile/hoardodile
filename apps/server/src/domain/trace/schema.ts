import type { ClientPlatform } from "@hoardodile/schemas"
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { TraceAction, TraceActionDetail } from "./actions.ts"

/**
 * Append-only user-action log ("footprint"). One row per discrete action:
 * imports, exports, deletes, restores, dislike toggles. `entityName` is a
 * snapshot taken at write time and the row never FK-links to the entity,
 * so the footprint survives hard deletes. Views are NOT recorded here —
 * the usage domain owns exposure data.
 */
export const userActions = sqliteTable(
	"user_actions",
	{
		id: text("id").primaryKey(),
		/** Action kind, one of {@link TraceAction}. */
		action: text("action").$type<TraceAction>().notNull(),
		/** Entity kind the action touched (e.g. `resource`). */
		entityType: text("entity_type").notNull(),
		/** Entity id the action touched. */
		entityId: text("entity_id").notNull(),
		/** Entity name snapshot at the time of the action. */
		entityName: text("entity_name").notNull(),
		/** Extra per-action context (bulk export flag, import provenance). */
		detail: text("detail", { mode: "json" })
			.$type<TraceActionDetail>()
			.notNull()
			.default({}),
		/** Platform the action was performed on (recorded from the request). */
		platform: text("platform")
			.$type<ClientPlatform>()
			.notNull()
			.default("web-pc"),
		createdAt: integer("created_at").notNull(),
	},
	(t) => [
		index("user_actions_created_at_idx").on(t.createdAt),
		index("user_actions_entity_idx").on(t.entityType, t.entityId),
	],
)

export type UserActionRow = typeof userActions.$inferSelect
export type UserActionInsert = typeof userActions.$inferInsert
