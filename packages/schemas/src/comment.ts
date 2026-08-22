import { MAX_COMMENT_BODY_LENGTH } from "@hoardodile/sdk-types/text-limits"
import { z } from "zod"
import { id, timestamp } from "./primitives.ts"
import { anchorData, resAnchor, resAnchorFilter } from "./res-anchor.ts"
import { MAX_PAGE_SIZE, MAX_SEARCH_QUERY_LENGTH } from "./text-limits.ts"

/**
 * User-authored comment that can be linked to zero or more characters
 * and resources, optionally nested as a reply to another comment.
 *
 * Bodies are immutable once created (each create is its own archival
 * record); only soft-delete state changes via `deletedAt`. Likes and
 * dislikes are stored as individual rows (one per click) so that each
 * click can be cancelled within a 24h window before being frozen forever.
 */
export const comment = z.object({
	id,
	parentId: id.optional(),
	body: z.string().min(1).max(MAX_COMMENT_BODY_LENGTH),
	createdAt: timestamp,
	/** `deletedAt` absent means the comment is live (same convention as char/res). */
	deletedAt: timestamp.optional(),
	charIds: z.array(id),
	resIds: z.array(id),
	likeCount: z.number().int().nonnegative(),
	dislikeCount: z.number().int().nonnegative(),
	replyCount: z.number().int().nonnegative(),
	/**
	 * Archived global floor number. Present only on top-level comments;
	 * omitted on replies.
	 */
	floor: z.number().int().positive().optional(),
	/**
	 * Optional pointer into a specific location within a resource.
	 * Plugin-specific location data is carried in `anchor.data`.
	 * When set, readers and the comment surface display an inline
	 * jump-target chip.
	 */
	anchor: resAnchor.optional(),
})

export type CommentFloorContext = {
	readonly replies: readonly Comment[]
}

export type Comment = z.infer<typeof comment> & {
	/**
	 * When the comment is a trashed floor root, `floorContext` carries
	 * all replies in the floor (both deleted and live) so the trash
	 * view can render the complete floor. Absent on live comments.
	 */
	readonly floorContext?: CommentFloorContext
}

export const commentVoteKind = z.enum(["like", "dislike"])

/**
 * Individual vote record. `cancellable` is `true` while the row is
 * still inside its 24h window -- the server computes it from
 * `createdAt` so clients do not need to embed clock logic.
 */
export const commentVote = z.object({
	id,
	commentId: id,
	kind: commentVoteKind,
	createdAt: timestamp,
	cancellable: z.boolean(),
})

export type CommentVote = z.infer<typeof commentVote>

export const commentSortBy = z.enum([
	"newest",
	"oldest",
	"mostLikes",
	"leastLikes",
])
export type CommentSortBy = z.infer<typeof commentSortBy>

export const commentListInput = z
	.object({
		query: z.string().max(MAX_SEARCH_QUERY_LENGTH).optional(),
		page: z.number().int().positive().optional(),
		size: z.number().int().positive().max(MAX_PAGE_SIZE).optional(),
		charId: id.optional(),
		resId: id.optional(),
		sortBy: commentSortBy.optional(),
		/**
		 * When `true`, returns floors (top-level threads) that contain
		 * at least one soft-deleted comment. Each returned root carries
		 * `floorContext.replies` with all replies (both deleted and
		 * live) so the trash view can render the complete floor.
		 * Defaults to `false` so live browsing keeps existing semantics.
		 */
		trashed: z.boolean().optional(),
		/**
		 * Filter to comments whose anchor targets the given resource.
		 * Plugin-specific location filtering is handled client-side
		 * by the plugin render module.
		 */
		anchor: resAnchorFilter.optional(),
	})
	.default({})

export type CommentListInput = z.infer<typeof commentListInput>

export const commentCreateInput = z.object({
	body: z.string().min(1).max(MAX_COMMENT_BODY_LENGTH),
	parentId: id.optional(),
	charIds: z.array(id).max(100).optional(),
	resIds: z.array(id).max(100).optional(),
	/**
	 * Resource this comment's anchor points into. Required when `anchor`
	 * is set; the server writes it to the row's `anchor_resource_id`
	 * column and merges it into `resIds`.
	 */
	anchorResId: id.optional(),
	/**
	 * Pointer into a resource location this comment is annotating. Only
	 * the plugin-defined location payload travels on the wire; the
	 * server derives the resource id from `anchorResId`.
	 */
	anchor: anchorData.optional(),
})

export type CommentCreateInput = z.infer<typeof commentCreateInput>

export const commentSoftDeleteInput = z.object({ id })
export type CommentSoftDeleteInput = z.infer<typeof commentSoftDeleteInput>

export const commentRestoreInput = z.object({ id })
export type CommentRestoreInput = z.infer<typeof commentRestoreInput>

export const commentHardDeleteInput = z.object({ id })
export type CommentHardDeleteInput = z.infer<typeof commentHardDeleteInput>

export const commentVoteInput = z.object({
	commentId: id,
	kind: commentVoteKind,
})

export type CommentVoteInput = z.infer<typeof commentVoteInput>

/**
 * Outcome of a vote click. Within the 24h window the server collapses
 * repeat clicks into toggle / swap operations rather than appending
 * new rows; outside the window each click creates an independent vote
 * that contributes permanently to the count.
 */
export const commentVoteAction = z.enum(["added", "cancelled", "swapped"])

export const commentVoteResult = z.object({
	action: commentVoteAction,
	vote: commentVote.optional(),
})

export type CommentVoteResult = z.infer<typeof commentVoteResult>

/**
 * Input for the thread query. By default, soft-deleted replies are
 * filtered out of the descendant set. When `fullContext` is `true`,
 * the server resolves the thread root and returns the entire floor
 * including live replies (used from the trash view).
 */
export const commentThreadInput = z.object({
	id,
	fullContext: z.boolean().optional(),
})

export type CommentThreadInput = z.infer<typeof commentThreadInput>

/**
 * Window during which a vote can still be cancelled, in milliseconds.
 */
export const COMMENT_VOTE_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000
