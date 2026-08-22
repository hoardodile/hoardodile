import { z } from "zod"
import { charCard } from "./char.ts"
import { comment } from "./comment.ts"
import { docSearchRow } from "./doc.ts"
import { resCard, similarFileMatch } from "./res.ts"
import { MAX_NAME_LENGTH, MAX_PAGE_SIZE } from "./text-limits.ts"

/**
 * Number of results shown per domain on the "all" scoped preview page.
 * Full single-domain searches use the caller-supplied page size.
 */
export const SEARCH_PREVIEW_SIZE = 8

export const searchScope = z.enum([
	"all",
	"characters",
	"resources",
	"documents",
	"messages",
])
export type SearchScope = z.infer<typeof searchScope>

export const searchGlobalInput = z.object({
	query: z.string().max(MAX_NAME_LENGTH).optional(),
	scope: searchScope.default("all"),
	page: z.number().int().positive().optional(),
	size: z.number().int().positive().max(MAX_PAGE_SIZE).optional(),
})
export type SearchGlobalInput = z.infer<typeof searchGlobalInput>

function listPageResultSchema<TItem extends z.ZodTypeAny>(itemSchema: TItem) {
	return z.object({
		rows: z.array(itemSchema).readonly(),
		total: z.number().int().nonnegative(),
		page: z.number().int().positive(),
		size: z.number().int().positive(),
	})
}

export const searchGlobalResult = z.object({
	query: z.string(),
	scope: searchScope,
	characters: listPageResultSchema(charCard),
	resources: listPageResultSchema(resCard),
	documents: listPageResultSchema(docSearchRow),
	messages: listPageResultSchema(comment),
})
export type SearchGlobalResult = z.infer<typeof searchGlobalResult>

/**
 * Reverse-image-search result: resources holding images perceptually
 * similar to the uploaded query image, ranked by best Hamming distance.
 * `files` lists the matched file pairs (same shape as
 * {@link similarImagesEntry}).
 */
export const imageSearchResult = z.object({
	results: z
		.array(
			z.object({
				resource: resCard,
				files: z.array(similarFileMatch),
			}),
		)
		.readonly(),
})
export type ImageSearchResult = z.infer<typeof imageSearchResult>
