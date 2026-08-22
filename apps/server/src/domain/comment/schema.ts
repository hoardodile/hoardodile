import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core"
import { characters } from "src/domain/char/schema.ts"
import { resources } from "src/domain/res/schema.ts"

/**
 * Domain table for {@link import("@hoardodile/schemas").Comment}.
 *
 * Comments are append-only — bodies are never edited after creation.
 * `parent_id` carries replies and forms a self-referential tree
 * (cascade on delete in the unlikely event a thread gets purged).
 * `deleted_at` is the only mutable field aside from the structural
 * cascades.
 */
export const comments = sqliteTable(
	"comments",
	{
		id: text("id").primaryKey(),
		// Self-reference: explicit annotation required so drizzle-kit
		// does not loop forever resolving the column type.
		parentId: text("parent_id").references((): AnySQLiteColumn => comments.id, {
			onDelete: "cascade",
		}),
		body: text("body").notNull(),
		createdAt: integer("created_at").notNull(),
		deletedAt: integer("deleted_at"),
		/**
		 * Archived global floor number for top-level comments only.
		 * Assigned at creation and never changed; replies leave this null.
		 */
		floor: integer("floor"),
		/**
		 * Optional pointer into a resource block this comment annotates
		 * (page, paragraph, timestamp, ...). The plugin location payload
		 * lives in `anchor_data` as JSON; the resource id is
		 * denormalised into its own column so the listing query can
		 * filter by anchor without parsing JSON for every row.
		 */
		anchorResourceId: text("anchor_resource_id").references(
			() => resources.id,
			{ onDelete: "cascade" },
		),
		/** Plugin location payload (`{"data": ...}`), or null. */
		anchorData: text("anchor_data"),
	},
	(t) => [
		index("comments_parent_id_idx").on(t.parentId),
		index("comments_created_at_idx").on(t.createdAt),
		index("comments_deleted_at_idx").on(t.deletedAt),
		index("comments_anchor_resource_idx").on(t.anchorResourceId),
	],
)

/** Many-to-many: comments ↔ characters. */
export const commentCharacters = sqliteTable(
	"comment_characters",
	{
		commentId: text("comment_id")
			.notNull()
			.references(() => comments.id, { onDelete: "cascade" }),
		charId: text("character_id")
			.notNull()
			.references(() => characters.id, { onDelete: "cascade" }),
	},
	(t) => [
		primaryKey({ columns: [t.commentId, t.charId] }),
		index("comment_characters_character_idx").on(t.charId),
	],
)

/** Many-to-many: comments ↔ resources. */
export const commentResources = sqliteTable(
	"comment_resources",
	{
		commentId: text("comment_id")
			.notNull()
			.references(() => comments.id, { onDelete: "cascade" }),
		resId: text("resource_id")
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),
	},
	(t) => [
		primaryKey({ columns: [t.commentId, t.resId] }),
		index("comment_resources_resource_idx").on(t.resId),
	],
)

/**
 * Individual like/dislike rows. Each click creates one row; rows are
 * deletable only within {@link COMMENT_VOTE_CANCEL_WINDOW_MS} of their
 * `createdAt`. After the window the vote is permanent.
 */
export const commentVotes = sqliteTable(
	"comment_votes",
	{
		id: text("id").primaryKey(),
		commentId: text("comment_id")
			.notNull()
			.references(() => comments.id, { onDelete: "cascade" }),
		kind: text("kind").notNull(), // "like" | "dislike"
		createdAt: integer("created_at").notNull(),
	},
	(t) => [
		index("comment_votes_comment_idx").on(t.commentId),
		index("comment_votes_kind_idx").on(t.commentId, t.kind),
	],
)
