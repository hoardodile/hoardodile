import type { ResAnchorFilter } from "@hoardodile/schemas"
import type { AnchorData } from "@hoardodile/sdk-types"
import {
	and,
	asc,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	like,
	type SQL,
	sql,
} from "drizzle-orm"
import {
	buildFindById,
	buildPatch,
	buildRemove,
} from "src/infra/db/builders.ts"
import type { DbClient } from "src/infra/db/connection.ts"
import {
	commentCharacters,
	commentResources,
	comments,
	commentVotes,
} from "./schema.ts"

export type CommentRow = typeof comments.$inferSelect
export type CommentVoteRow = typeof commentVotes.$inferSelect

export type CommentDbValues = {
	readonly parentId: string | null
	readonly body: string
	readonly deletedAt: number | null
	readonly floor: number | null
	/** Plugin location payload (wire envelope without resId). */
	readonly anchor: AnchorData | undefined
	/**
	 * Resource the anchor points into — written to the row's
	 * `anchor_resource_id` column. Undefined when the comment is not
	 * anchored.
	 */
	readonly anchorResId: string | undefined
}

export type CommentDbPatch = Partial<
	Pick<typeof comments.$inferInsert, "deletedAt">
>

export type CommentListFilter = {
	readonly query: string
	readonly charId: string | undefined
	readonly resId: string | undefined
	readonly anchor: ResAnchorFilter | undefined
	readonly trashed: boolean
	readonly sortBy: "newest" | "oldest" | "mostLikes" | "leastLikes"
	readonly limit: number
	readonly offset: number
}

export type CommentVoteCounts = {
	readonly likeCount: number
	readonly dislikeCount: number
}

/**
 * Drizzle-backed query layer for the comment module. Spans four
 * tables: `comments`, `comment_characters`, `comment_resources`, and
 * `comment_votes`.
 */
export type CommentRepository = {
	/** @throws {DomainError} NOT_FOUND when the row is missing. */
	findById(id: string): CommentRow
	insert(id: string, values: CommentDbValues, ts: number): void
	/**
	 * Atomically insert a comment and attach its character / resource links.
	 * Either the whole row+links tuple is written, or nothing is.
	 */
	insertWithLinks(
		id: string,
		values: CommentDbValues,
		ts: number,
		charIds: readonly string[],
		resIds: readonly string[],
	): void
	patch(id: string, fields: CommentDbPatch): void
	remove(id: string): void

	/** Top-level listing with filters and sort applied. */
	listTopLevel(filter: CommentListFilter): readonly CommentRow[]
	/**
	 * Distinct root IDs of floors (top-level threads) that contain at
	 * least one soft-deleted comment (root or any reply). Used by the
	 * trash view to list complete floors.
	 */
	findTrashedFloorRootIds(): readonly string[]
	/**
	 * List top-level comments whose IDs are in the given set, with
	 * filter conditions (query/charId/resId/anchor), sort, and
	 * pagination. Does NOT apply the `trashed` soft-delete filter —
	 * both deleted and live roots are returned.
	 */
	listRootsByIds(
		ids: readonly string[],
		filter: CommentListFilter,
	): readonly CommentRow[]
	/** Count of top-level comments matching `listRootsByIds` (no sort/page). */
	countRootsByIds(
		ids: readonly string[],
		filter: Omit<CommentListFilter, "limit" | "offset" | "sortBy">,
	): number
	/** Total count of top-level comments matching the same filter. */
	countTopLevel(
		filter: Omit<CommentListFilter, "limit" | "offset" | "sortBy">,
	): number
	/** Total count of all comments (including replies) matching the same filter. */
	countAll(
		filter: Omit<CommentListFilter, "limit" | "offset" | "sortBy">,
	): number
	/** All replies for a thread (comments whose parentId is in `parentIds`). */
	listRepliesFor(parentIds: readonly string[]): readonly CommentRow[]
	/** Direct reply count keyed by parent id. */
	replyCounts(commentIds: readonly string[]): ReadonlyMap<string, number>
	/** Next archived floor number for a new top-level comment. */
	nextTopLevelFloor(): number
	/** Walk parent links until the thread root id is reached. */
	findRootId(id: string): string

	attachCharacters(commentId: string, ids: readonly string[]): void
	attachResources(commentId: string, ids: readonly string[]): void
	listCharacterIds(commentIds: readonly string[]): ReadonlyMap<string, string[]>
	listResourceIds(commentIds: readonly string[]): ReadonlyMap<string, string[]>

	insertVote(
		id: string,
		commentId: string,
		kind: "like" | "dislike",
		ts: number,
	): void
	/**
	 * Atomically replace one vote with another (same comment, possibly
	 * different kind). If this throws, neither the delete nor the insert
	 * is visible.
	 */
	swapVote(
		deleteId: string,
		insertId: string,
		commentId: string,
		kind: "like" | "dislike",
		ts: number,
	): void
	findVote(id: string): CommentVoteRow | undefined
	deleteVote(id: string): void
	listVotesFor(commentIds: readonly string[]): readonly CommentVoteRow[]
	voteCounts(
		commentIds: readonly string[],
	): ReadonlyMap<string, CommentVoteCounts>
}

export function buildCommentRepository(client: DbClient): CommentRepository {
	const findById = buildFindById<CommentRow>(client, comments, "comment")
	const patch = buildPatch<CommentDbPatch>(client, comments)
	const remove = buildRemove(client, comments)

	function nextTopLevelFloor(): number {
		const row = client
			.select({ next: sql<number>`COALESCE(MAX(${comments.floor}), 0) + 1` })
			.from(comments)
			.where(sql`${comments.parentId} IS NULL`)
			.get()
		return row?.next ?? 1
	}

	function findRootId(id: string): string {
		let current = findById(id)
		while (current.parentId !== null) {
			current = findById(current.parentId)
		}
		return current.id
	}

	function insert(id: string, values: CommentDbValues, ts: number): void {
		client
			.insert(comments)
			.values({
				id,
				parentId: values.parentId,
				body: values.body,
				deletedAt: values.deletedAt,
				floor: values.floor,
				createdAt: ts,
				anchorResourceId: values.anchorResId ?? null,
				anchorData:
					values.anchor === undefined ? null : JSON.stringify(values.anchor),
			})
			.run()
	}

	function insertWithLinks(
		id: string,
		values: CommentDbValues,
		ts: number,
		charIds: readonly string[],
		resIds: readonly string[],
	): void {
		client.transaction((tx) => {
			tx.insert(comments)
				.values({
					id,
					parentId: values.parentId,
					body: values.body,
					deletedAt: values.deletedAt,
					floor: values.floor,
					createdAt: ts,
					anchorResourceId: values.anchorResId ?? null,
					anchorData:
						values.anchor === undefined ? null : JSON.stringify(values.anchor),
				})
				.run()
			if (charIds.length > 0) {
				tx.insert(commentCharacters)
					.values(charIds.map((charId) => ({ commentId: id, charId })))
					.onConflictDoNothing()
					.run()
			}
			if (resIds.length > 0) {
				tx.insert(commentResources)
					.values(resIds.map((resId) => ({ commentId: id, resId })))
					.onConflictDoNothing()
					.run()
			}
		})
	}

	function buildSearchClause(
		filter: {
			readonly query: string
			readonly charId: string | undefined
			readonly resId: string | undefined
			readonly anchor: ResAnchorFilter | undefined
			readonly trashed: boolean
		},
		topLevelOnly: boolean,
	) {
		const clauses = []
		if (topLevelOnly) {
			clauses.push(sql`${comments.parentId} IS NULL`)
		}
		clauses.push(
			filter.trashed
				? isNotNull(comments.deletedAt)
				: isNull(comments.deletedAt),
		)
		if (filter.query.length > 0) {
			const needle = `%${filter.query}%`
			clauses.push(like(comments.body, needle))
		}
		if (filter.charId !== undefined) {
			const cid = filter.charId
			clauses.push(
				sql`EXISTS (SELECT 1 FROM ${commentCharacters} WHERE ${commentCharacters.commentId} = ${comments.id} AND ${commentCharacters.charId} = ${cid})`,
			)
		}
		if (filter.resId !== undefined) {
			const rid = filter.resId
			clauses.push(
				sql`EXISTS (SELECT 1 FROM ${commentResources} WHERE ${commentResources.commentId} = ${comments.id} AND ${commentResources.resId} = ${rid})`,
			)
		}
		if (filter.anchor !== undefined) {
			clauses.push(eq(comments.anchorResourceId, filter.anchor.resId))
		}
		return and(...clauses)
	}

	function listTopLevel(filter: CommentListFilter): readonly CommentRow[] {
		const where = buildSearchClause(filter, true)
		const baseOrder =
			filter.sortBy === "oldest"
				? [asc(comments.createdAt)]
				: [desc(comments.createdAt)]
		if (filter.sortBy === "mostLikes" || filter.sortBy === "leastLikes") {
			const likeCount = sql<number>`(SELECT COUNT(*) FROM ${commentVotes} WHERE ${commentVotes.commentId} = ${comments.id} AND ${commentVotes.kind} = 'like')`
			return client
				.select()
				.from(comments)
				.where(where)
				.orderBy(
					filter.sortBy === "mostLikes" ? desc(likeCount) : asc(likeCount),
					desc(comments.createdAt),
				)
				.limit(filter.limit)
				.offset(filter.offset)
				.all()
		}
		return client
			.select()
			.from(comments)
			.where(where)
			.orderBy(...baseOrder)
			.limit(filter.limit)
			.offset(filter.offset)
			.all()
	}

	function findTrashedFloorRootIds(): readonly string[] {
		const rows = client.all(sql`
			WITH RECURSIVE tree(id, root_id) AS (
				SELECT id, id AS root_id FROM ${comments} WHERE parent_id IS NULL
				UNION ALL
				SELECT c.id, t.root_id FROM ${comments} c JOIN tree t ON c.parent_id = t.id
			)
			SELECT DISTINCT t.root_id AS id
			FROM tree t
			INNER JOIN ${comments} del ON del.id = t.id AND del.deleted_at IS NOT NULL
		`) as readonly { id: string }[]
		return rows.map((r) => r.id)
	}

	function buildRootsByIdsClause(
		ids: readonly string[],
		filter: {
			readonly query: string
			readonly charId: string | undefined
			readonly resId: string | undefined
			readonly anchor: ResAnchorFilter | undefined
		},
	) {
		const clauses: SQL[] = [
			sql`${comments.parentId} IS NULL`,
			inArray(comments.id, ids as string[]),
		]
		if (filter.query.length > 0) {
			clauses.push(like(comments.body, `%${filter.query}%`))
		}
		if (filter.charId !== undefined) {
			const cid = filter.charId
			clauses.push(
				sql`EXISTS (SELECT 1 FROM ${commentCharacters} WHERE ${commentCharacters.commentId} = ${comments.id} AND ${commentCharacters.charId} = ${cid})`,
			)
		}
		if (filter.resId !== undefined) {
			const rid = filter.resId
			clauses.push(
				sql`EXISTS (SELECT 1 FROM ${commentResources} WHERE ${commentResources.commentId} = ${comments.id} AND ${commentResources.resId} = ${rid})`,
			)
		}
		if (filter.anchor !== undefined) {
			clauses.push(eq(comments.anchorResourceId, filter.anchor.resId))
		}
		return and(...clauses)
	}

	function listRootsByIds(
		ids: readonly string[],
		filter: CommentListFilter,
	): readonly CommentRow[] {
		if (ids.length === 0) return []
		const where = buildRootsByIdsClause(ids, filter)
		const baseOrder =
			filter.sortBy === "oldest"
				? [asc(comments.createdAt)]
				: [desc(comments.createdAt)]
		if (filter.sortBy === "mostLikes" || filter.sortBy === "leastLikes") {
			const likeCount = sql<number>`(SELECT COUNT(*) FROM ${commentVotes} WHERE ${commentVotes.commentId} = ${comments.id} AND ${commentVotes.kind} = 'like')`
			return client
				.select()
				.from(comments)
				.where(where)
				.orderBy(
					filter.sortBy === "mostLikes" ? desc(likeCount) : asc(likeCount),
					desc(comments.createdAt),
				)
				.limit(filter.limit)
				.offset(filter.offset)
				.all()
		}
		return client
			.select()
			.from(comments)
			.where(where)
			.orderBy(...baseOrder)
			.limit(filter.limit)
			.offset(filter.offset)
			.all()
	}

	function countRootsByIds(
		ids: readonly string[],
		filter: Omit<CommentListFilter, "limit" | "offset" | "sortBy">,
	): number {
		if (ids.length === 0) return 0
		const where = buildRootsByIdsClause(ids, filter)
		const row = client
			.select({ value: sql<number>`COUNT(*)` })
			.from(comments)
			.where(where)
			.get()
		return row?.value ?? 0
	}

	function countTopLevel(
		filter: Omit<CommentListFilter, "limit" | "offset" | "sortBy">,
	): number {
		const where = buildSearchClause(filter, true)
		const row = client
			.select({ value: sql<number>`COUNT(*)` })
			.from(comments)
			.where(where)
			.get()
		return row?.value ?? 0
	}

	function countAll(
		filter: Omit<CommentListFilter, "limit" | "offset" | "sortBy">,
	): number {
		const where = buildSearchClause(filter, false)
		const row = client
			.select({ value: sql<number>`COUNT(*)` })
			.from(comments)
			.where(where)
			.get()
		return row?.value ?? 0
	}

	function listRepliesFor(parentIds: readonly string[]): readonly CommentRow[] {
		if (parentIds.length === 0) return []
		// Collect descendant ids via a recursive CTE, then re-fetch typed rows
		// through Drizzle so column names get camelCase-mapped correctly
		// (raw `c.*` returns snake_case keys that do not match CommentRow).
		const seeds = sql.join(
			parentIds.map((id) => sql`${id}`),
			sql`, `,
		)
		const idRows = client.all(sql`
			WITH RECURSIVE descendants(id) AS (
				SELECT id FROM ${comments} WHERE parent_id IN (${seeds})
				UNION ALL
				SELECT c.id FROM ${comments} c JOIN descendants d ON c.parent_id = d.id
			)
			SELECT id FROM descendants
		`) as readonly { id: string }[]
		if (idRows.length === 0) return []
		const ids = idRows.map((r) => r.id)
		return client
			.select()
			.from(comments)
			.where(inArray(comments.id, ids))
			.orderBy(asc(comments.createdAt))
			.all()
	}

	function replyCounts(
		commentIds: readonly string[],
	): ReadonlyMap<string, number> {
		if (commentIds.length === 0) return new Map()
		const rows = client
			.select({
				parentId: comments.parentId,
				value: sql<number>`COUNT(*)`,
			})
			.from(comments)
			.where(inArray(comments.parentId, commentIds as string[]))
			.groupBy(comments.parentId)
			.all()
		const out = new Map<string, number>()
		for (const r of rows) if (r.parentId !== null) out.set(r.parentId, r.value)
		return out
	}

	function attachCharacters(commentId: string, ids: readonly string[]): void {
		if (ids.length === 0) return
		client
			.insert(commentCharacters)
			.values(ids.map((charId) => ({ commentId, charId })))
			.onConflictDoNothing()
			.run()
	}

	function attachResources(commentId: string, ids: readonly string[]): void {
		if (ids.length === 0) return
		client
			.insert(commentResources)
			.values(ids.map((resId) => ({ commentId, resId })))
			.onConflictDoNothing()
			.run()
	}

	function listCharacterIds(
		commentIds: readonly string[],
	): ReadonlyMap<string, string[]> {
		const out = new Map<string, string[]>()
		if (commentIds.length === 0) return out
		const rows = client
			.select()
			.from(commentCharacters)
			.where(inArray(commentCharacters.commentId, commentIds as string[]))
			.all()
		for (const r of rows) {
			let list = out.get(r.commentId)
			if (list === undefined) {
				list = []
				out.set(r.commentId, list)
			}
			list.push(r.charId)
		}
		return out
	}

	function listResourceIds(
		commentIds: readonly string[],
	): ReadonlyMap<string, string[]> {
		const out = new Map<string, string[]>()
		if (commentIds.length === 0) return out
		const rows = client
			.select()
			.from(commentResources)
			.where(inArray(commentResources.commentId, commentIds as string[]))
			.all()
		for (const r of rows) {
			let list = out.get(r.commentId)
			if (list === undefined) {
				list = []
				out.set(r.commentId, list)
			}
			list.push(r.resId)
		}
		return out
	}

	function insertVote(
		id: string,
		commentId: string,
		kind: "like" | "dislike",
		ts: number,
	): void {
		client
			.insert(commentVotes)
			.values({ id, commentId, kind, createdAt: ts })
			.run()
	}

	function findVote(id: string): CommentVoteRow | undefined {
		return client
			.select()
			.from(commentVotes)
			.where(eq(commentVotes.id, id))
			.get()
	}

	function deleteVote(id: string): void {
		client.delete(commentVotes).where(eq(commentVotes.id, id)).run()
	}

	function swapVote(
		deleteId: string,
		insertId: string,
		commentId: string,
		kind: "like" | "dislike",
		ts: number,
	): void {
		client.transaction((tx) => {
			tx.delete(commentVotes).where(eq(commentVotes.id, deleteId)).run()
			tx.insert(commentVotes)
				.values({ id: insertId, commentId, kind, createdAt: ts })
				.run()
		})
	}

	function listVotesFor(
		commentIds: readonly string[],
	): readonly CommentVoteRow[] {
		if (commentIds.length === 0) return []
		return client
			.select()
			.from(commentVotes)
			.where(inArray(commentVotes.commentId, commentIds as string[]))
			.orderBy(desc(commentVotes.createdAt))
			.all()
	}

	function voteCounts(
		commentIds: readonly string[],
	): ReadonlyMap<string, CommentVoteCounts> {
		const out = new Map<string, CommentVoteCounts>()
		if (commentIds.length === 0) return out
		const rows = client
			.select({
				commentId: commentVotes.commentId,
				kind: commentVotes.kind,
				value: sql<number>`COUNT(*)`,
			})
			.from(commentVotes)
			.where(inArray(commentVotes.commentId, commentIds as string[]))
			.groupBy(commentVotes.commentId, commentVotes.kind)
			.all()
		for (const r of rows) {
			const cur = out.get(r.commentId) ?? { likeCount: 0, dislikeCount: 0 }
			out.set(r.commentId, {
				likeCount: r.kind === "like" ? r.value : cur.likeCount,
				dislikeCount: r.kind === "dislike" ? r.value : cur.dislikeCount,
			})
		}
		return out
	}

	return {
		findById,
		insert,
		insertWithLinks,
		patch,
		remove,
		listTopLevel,
		findTrashedFloorRootIds,
		listRootsByIds,
		countRootsByIds,
		countTopLevel,
		countAll,
		listRepliesFor,
		replyCounts,
		nextTopLevelFloor,
		findRootId,
		attachCharacters,
		attachResources,
		listCharacterIds,
		listResourceIds,
		insertVote,
		swapVote,
		findVote,
		deleteVote,
		listVotesFor,
		voteCounts,
	}
}
