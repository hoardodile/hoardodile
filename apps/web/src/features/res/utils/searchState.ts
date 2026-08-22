import { MAX_PAGE_SIZE } from "@hoardodile/schemas"

import type { PluginManifestId } from "@hoardodile/sdk-types"
import type { SortBy, SortOrder, TagFilterMode } from "@hoardodile/shared"
import { sortBy, sortOrder, tagFilterMode } from "@hoardodile/shared"
import { z } from "zod"
import { RESOURCE_PAGE_SIZE } from "../api"

/**
 * Shared state shape for the resource search experience.
 */
export type ResSearchState = {
	readonly query: string
	readonly page: number
	readonly size: number
	readonly tagIds: readonly string[]
	readonly tagMode: TagFilterMode
	readonly noCharacters: boolean
	/** Character facet — resources carrying any of these (OR within the facet). */
	readonly charIds: readonly string[]
	readonly trash: boolean
	readonly sortBy: SortBy
	readonly order: SortOrder
	readonly random: boolean
	readonly showOnlySelected: boolean
	readonly contentPluginId: PluginManifestId | ""
	readonly searchMetaFacets: Record<string, boolean>
	readonly searchIntro: boolean
	/** Exact-match source name filter; empty string means "any source". */
	readonly sourceName: string
	/** Resources in any of these collections (OR within the facet). */
	readonly colIds: readonly string[]
	readonly dislikedOnly: boolean
	/** Card layout: proportional grid rows or CSS-columns masonry. */
	readonly view: "grid" | "masonry"
}

export const RESOURCE_SEARCH_DEFAULTS: ResSearchState = {
	query: "",
	page: 1,
	size: RESOURCE_PAGE_SIZE,
	tagIds: [],
	tagMode: "and",
	noCharacters: false,
	charIds: [],
	trash: false,
	sortBy: "created",
	order: "desc",
	random: false,
	showOnlySelected: false,
	contentPluginId: "",
	searchMetaFacets: {},
	searchIntro: false,
	sourceName: "",
	colIds: [],
	dislikedOnly: false,
	view: "grid",
}

/** Page size choices surfaced in the search UI. */
export const RESOURCE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

const contentPluginId = z.string()

/**
 * Loose Zod schema for `<ResSearch>` route search params.
 * All fields optional so partial URLs (e.g. only `?query=foo`) still validate.
 */
export const resSearchUrlSchema = z
	.object({
		query: z.string().optional(),
		page: z.coerce.number().int().min(1).optional(),
		size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
		tagIds: z.array(z.string()).optional(),
		tagMode: tagFilterMode.optional(),
		noCharacters: z.coerce.boolean().optional(),
		charIds: z.array(z.string()).optional(),
		trash: z.coerce.boolean().optional(),
		sortBy: sortBy.optional(),
		order: sortOrder.optional(),
		random: z.coerce.boolean().optional(),
		showOnlySelected: z.coerce.boolean().optional(),
		contentPluginId: contentPluginId.optional(),
		searchMetaFacets: z.record(z.string(), z.boolean()).optional(),
		searchIntro: z.coerce.boolean().optional(),
		sourceName: z.string().optional(),
		colIds: z.array(z.string()).optional(),
		dislikedOnly: z.coerce.boolean().optional(),
		view: z.enum(["grid", "masonry"]).optional(),
		/** Legacy single-character filter — detail-page "view all resources"
		    links land here; merged into {@link charIds} by the search. */
		charId: z.string().min(1).optional(),
	})
	.loose()
