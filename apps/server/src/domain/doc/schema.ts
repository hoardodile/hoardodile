import {
	blob,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core"

/**
 * All tables for the document (knowledge base) module.
 *
 * The directory tree uses an adjacency list: `parent_id` points to the
 * parent node; NULL means the node is mounted directly under the
 * implicit root (the frontend renders only the root's children, so it
 * looks like multiple roots). `position` orders siblings under the same
 * parent.
 *
 * Each `documents` row carries both the draft state and the HEAD version
 * pointer:
 * - `draft_*` columns hold the uncommitted current edit (only meaningful
 *   when kind=document);
 * - `head_version_id` points to the latest committed row in
 *   `document_versions`;
 * - commit = insert a versions row + update head_version_id + clear
 *   draft_* fields (content reset to empty doc; char/res draft mirrors emptied);
 * - "adopt history version as draft" = copy the chosen version's
 *   contents back into draft_*.
 *
 * Tree position is intentionally NOT versioned (moving a node never
 * creates a new version).
 *
 * The search projection column `search_text` is rewritten by the
 * service on every commit as `title + textified content`, used by LIKE
 * queries; drafts are not searched.
 *
 * The char/res link tables (`document_char_links` / `document_res_links`)
 * are refreshed on commit; draft state is never indexed.
 */
export const documents = sqliteTable(
	"documents",
	{
		id: text("id").primaryKey(),
		/** NULL = mounted directly under the implicit root. Cycle detection only applies to live (non-deleted) nodes. */
		parentId: text("parent_id"),
		/** "folder" | "document". Folders ignore every draft_/head_/search_ field. */
		kind: text("kind").notNull(),
		title: text("title").notNull(),
		position: integer("position").notNull().default(0),
		/** Draft title; `undefined`/NULL = identical to `title`. */
		draftTitle: text("draft_title"),
		/**
		 * Gzipped Tiptap JSON body. NULL means the user has no draft —
		 * the editor falls back to the HEAD version's body so a freshly
		 * committed document still renders content on reopen.
		 */
		draftContentBlob: blob("draft_content_blob", { mode: "buffer" }),
		draftCharIds: text("draft_char_ids", { mode: "json" })
			.$type<readonly string[]>()
			.notNull()
			.default([]),
		draftResIds: text("draft_res_ids", { mode: "json" })
			.$type<readonly string[]>()
			.notNull()
			.default([]),
		draftUpdatedAt: integer("draft_updated_at"),
		headVersionId: text("head_version_id"),
		/** Plain-text search projection rewritten on every commit. */
		searchText: text("search_text").notNull().default(""),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
		deletedAt: integer("deleted_at"),
	},
	(t) => [
		index("documents_parent_position_idx").on(t.parentId, t.position),
		index("documents_deleted_at_idx").on(t.deletedAt),
		index("documents_kind_idx").on(t.kind),
	],
)

/**
 * Committed version snapshot. `version_no` is monotonically increasing
 * within a single doc_id starting at 1. `content` is Tiptap JSON;
 * charIds/resIds are stored as JSON arrays (versions are immutable so we
 * never index them — index lookups go through the HEAD-projection link tables).
 */
export const docVersions = sqliteTable(
	"document_versions",
	{
		id: text("id").primaryKey(),
		docId: text("doc_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		versionNo: integer("version_no").notNull(),
		title: text("title").notNull(),
		/** Gzipped Tiptap JSON snapshot — versions are immutable so this is always populated. */
		contentBlob: blob("content_blob", { mode: "buffer" }).notNull(),
		charIds: text("char_ids", { mode: "json" })
			.$type<readonly string[]>()
			.notNull()
			.default([]),
		resIds: text("res_ids", { mode: "json" })
			.$type<readonly string[]>()
			.notNull()
			.default([]),
		message: text("message").notNull().default(""),
		createdAt: integer("created_at").notNull(),
	},
	(t) => [
		uniqueIndex("document_versions_doc_no_idx").on(t.docId, t.versionNo),
		index("document_versions_doc_idx").on(t.docId),
	],
)

/**
 * Char index table refreshed on commit. Indexes "document → char ids
 * referenced in its HEAD version". Draft char references only live in
 * documents.draftCharIds and never enter this table.
 */
export const docCharLinks = sqliteTable(
	"document_char_links",
	{
		docId: text("doc_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		charId: text("char_id").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.docId, t.charId] }),
		index("document_char_links_char_idx").on(t.charId),
	],
)

/** Resource index table refreshed on commit. */
export const docResLinks = sqliteTable(
	"document_res_links",
	{
		docId: text("doc_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		resId: text("res_id").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.docId, t.resId] }),
		index("document_res_links_res_idx").on(t.resId),
	],
)
