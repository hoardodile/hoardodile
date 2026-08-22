import { z } from "zod"
import { id, timestamp } from "./primitives.ts"
import {
	MAX_COMMIT_MESSAGE_LENGTH,
	MAX_DOC_SEARCH_QUERY_LENGTH,
	MAX_DOC_SNIPPET_LENGTH,
	MAX_NAME_LENGTH,
	MAX_PAGE_SIZE,
} from "./text-limits.ts"

/**
 * Shared schemas for the document (knowledge base) module.
 *
 * Data model:
 * - Adjacency-list tree: every node has `parentId` (root nodes have
 *   `parentId === undefined`; the frontend never renders that implicit
 *   root, so it looks like multiple roots) and `position` (sibling
 *   ordering under the same parent).
 * - `kind` distinguishes folders from documents; folders carry no
 *   content / version / draft, only child nodes.
 * - A document holds two content tracks -- "draft" and "HEAD version":
 *   uncommitted edits live in the draft and auto-save; committing
 *   appends a versions row and updates `headVersionId`. History is not
 *   reverted in place; "adopt this version as draft" then re-commit
 *   (revert-style) is the only path back.
 * - Char/res references store ids only; the frontend renders chips /
 *   preview cards live from the id, with no business behaviour.
 * - Tree position (parentId / position) is intentionally not versioned.
 */

export const docNodeKind = z.enum(["folder", "document"])
export type DocNodeKind = z.infer<typeof docNodeKind>

/** Tree node (folder or document) metadata. `content` is not part of this schema. */
export const docNode = z.object({
	id,
	parentId: id.optional(),
	kind: docNodeKind,
	title: z.string().min(1).max(MAX_NAME_LENGTH),
	position: z.number().int(),
	createdAt: timestamp,
	updatedAt: timestamp,
	deletedAt: timestamp.optional(),
})
export type DocNode = z.infer<typeof docNode>

/**
 * Document row returned by full-text search. Carries the same metadata as
 * {@link docNode} plus a short plain-text snippet for result previews.
 */
export const docSearchRow = docNode.extend({
	snippet: z.string().max(MAX_DOC_SNIPPET_LENGTH).optional(),
})
export type DocSearchRow = z.infer<typeof docSearchRow>

/**
 * Tiptap document JSON. We deliberately do not strict-validate the
 * ProseMirror node structure at the zod layer -- the editor and its
 * NodeViews are the single source of truth; here we only ensure it is
 * a JSON object.
 *
 * A plain-text character ceiling is enforced by the frontend editor
 * status bar (real-time) and the server service layer (write-time),
 * avoiding expensive JSON.stringify at the schema validation layer.
 */
export const docContent = z.record(z.string(), z.unknown())
export type DocContent = z.infer<typeof docContent>

/** Single-document draft snapshot. Folders never have a draft. */
export const docDraft = z.object({
	docId: id,
	title: z.string().min(1).max(MAX_NAME_LENGTH),
	content: docContent,
	charIds: z.array(id).default([]),
	resIds: z.array(id).default([]),
	updatedAt: timestamp,
})
export type DocDraft = z.infer<typeof docDraft>

/**
 * Committed version snapshot. Each commit appends a row; `versionNo`
 * is monotonically increasing within `docId` starting at 1. Versions
 * deliberately do NOT carry parentId / position (tree position is not
 * versioned).
 */
export const docVersion = z.object({
	id,
	docId: id,
	versionNo: z.number().int().positive(),
	title: z.string().min(1).max(MAX_NAME_LENGTH),
	content: docContent,
	charIds: z.array(id).default([]),
	resIds: z.array(id).default([]),
	message: z.string().max(MAX_COMMIT_MESSAGE_LENGTH).default(""),
	createdAt: timestamp,
})
export type DocVersion = z.infer<typeof docVersion>

/**
 * History-list projection: same as `docVersion` but the (often
 * large) `content` payload is dropped. Lists of versions only need
 * versionNo / title / message / timestamp for display, so the editor
 * page never round-trips full snapshots until the user explicitly
 * inspects one.
 */
export const docVersionMeta = docVersion.omit({ content: true })
export type DocVersionMeta = z.infer<typeof docVersionMeta>

/** Combined detail-page payload -- node + (optional) draft + version metadata in one round-trip. */
export const docNodeView = z.object({
	node: docNode,
	draft: docDraft.optional(),
	versions: z.array(docVersionMeta).default([]),
})
export type DocNodeView = z.infer<typeof docNodeView>

/**
 * Merged detail-page bootstrap payload. Returns the full live tree and the
 * active document's node view in a single round-trip so the layout shell and
 * the detail route never fan out into two tRPC calls.
 */
export const docDetailPageOutput = z.object({
	tree: z.array(docNode),
	nodeView: docNodeView,
})
export type DocDetailPageOutput = z.infer<typeof docDetailPageOutput>

// ---- Inputs ----

export const docCreateInput = z.object({
	parentId: id.optional(),
	kind: docNodeKind,
	title: z.string().min(1).max(MAX_NAME_LENGTH),
	position: z.number().int().optional(),
})
export type DocCreateInput = z.infer<typeof docCreateInput>

export const docRenameInput = z.object({
	id,
	title: z.string().min(1).max(MAX_NAME_LENGTH),
})
export type DocRenameInput = z.infer<typeof docRenameInput>

/**
 * Partial draft patch; every field is optional and omitting it leaves the
 * value untouched.
 *
 * `expectedUpdatedAt` is an optimistic-concurrency guard for offline sync
 * pushes: it must equal the draft's current `updatedAt` (as reported by
 * {@link docDraft}, i.e. `draftUpdatedAt ?? updatedAt`), otherwise the
 * patch is rejected with a CONFLICT so a stale offline client can never
 * silently clobber a newer remote draft.
 */
export const docDraftPatchInput = z.object({
	id,
	title: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
	content: docContent.optional(),
	charIds: z.array(id).optional(),
	resIds: z.array(id).optional(),
	expectedUpdatedAt: timestamp.optional(),
})
export type DocDraftPatchInput = z.infer<typeof docDraftPatchInput>

export const docCommitInput = z.object({
	id,
	message: z.string().max(MAX_COMMIT_MESSAGE_LENGTH).optional(),
})
export type DocCommitInput = z.infer<typeof docCommitInput>

export const docAdoptVersionInput = z.object({
	docId: id,
	versionId: id,
})
export type DocAdoptVersionInput = z.infer<typeof docAdoptVersionInput>

/** Batch-move a group of nodes: single transaction + cycle detection. `position` is supplied explicitly. */
export const docMoveItem = z.object({
	id,
	parentId: id.optional(),
	position: z.number().int(),
})
export type DocMoveItem = z.infer<typeof docMoveItem>

export const docMoveBatchInput = z.object({
	moves: z.array(docMoveItem).min(1).max(1000),
})
export type DocMoveBatchInput = z.infer<typeof docMoveBatchInput>

/** Search / filter entry point. `query` runs LIKE; char/res run EXISTS-indexed sub-clauses. */
export const docSearchInput = z.object({
	query: z.string().max(MAX_DOC_SEARCH_QUERY_LENGTH).optional(),
	parentId: id.optional(),
	charIds: z.array(id).optional(),
	resIds: z.array(id).optional(),
	/**
	 * When `true`, only soft-deleted (trashed) nodes are returned. Used
	 * by the recycle-bin view; defaults to `false` so live searches keep
	 * their existing semantics.
	 */
	trashed: z.boolean().optional(),
	page: z.number().int().positive().optional(),
	size: z.number().int().positive().max(MAX_PAGE_SIZE).optional(),
})
export type DocSearchInput = z.infer<typeof docSearchInput>
