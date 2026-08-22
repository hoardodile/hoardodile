import type { CommentSortBy } from "@hoardodile/schemas"
import { commentSortBy, MAX_SEARCH_QUERY_LENGTH } from "@hoardodile/schemas"
import { z } from "zod"

export const COMMENT_PAGE_SIZE = 10

export type CommentSearchState = {
	readonly charId: string
	readonly resId: string
	readonly query: string
	readonly sortBy: CommentSortBy
	readonly trash: boolean
	readonly page: number
	readonly size: number
}

export const COMMENT_SEARCH_DEFAULTS: CommentSearchState = {
	charId: "",
	resId: "",
	query: "",
	sortBy: "newest",
	trash: false,
	page: 1,
	size: COMMENT_PAGE_SIZE,
}

export const commentSearchUrlSchema = z.object({
	charId: z.string().optional(),
	resId: z.string().optional(),
	query: z.string().max(MAX_SEARCH_QUERY_LENGTH).optional(),
	sortBy: commentSortBy.optional(),
	trash: z.coerce.boolean().optional(),
	page: z.coerce.number().int().min(1).optional(),
})

export const SORT_OPTIONS = [
	"newest",
	"oldest",
	"mostLikes",
	"leastLikes",
] as const satisfies readonly CommentSortBy[]
