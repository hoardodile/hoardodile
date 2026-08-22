import {
	MAX_ID_FILTER_SIZE,
	MAX_PAGE_SIZE,
	MAX_SEARCH_QUERY_LENGTH,
	traitFilter,
} from "@hoardodile/schemas"
import { pluginManifestId } from "@hoardodile/sdk-types/schema"
import { sortBy, sortOrder, tagFilterMode } from "@hoardodile/shared"
import { z } from "zod"

export const idInput = z.object({ id: z.string().min(1) })

/** Batch resource deletes; `max` matches {@link listInput} page size cap. */
export const resourceIdsInput = z.object({
	ids: z.array(z.string().min(1)).min(1).max(MAX_PAGE_SIZE),
})

/**
 * Input for "force delete" procedures (tag, category, trait). Requires
 * both the entity id and its current name as a confirmation token; the
 * service rejects the call if the names do not match, guarding against
 * stale UI references after a rename.
 */
export const forceDeleteInput = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
})

/**
 * Input for tag attach/detach procedures. `entityId` is the resource or
 * character id; the entity kind is encoded in the procedure name
 * (`attachToResource` vs `attachToCharacter`).
 */
export const tagAttachmentInput = z.object({
	entityId: z.string().min(1),
	tagId: z.string().min(1),
})

const listInputShape = z.object({
	query: z.string().max(MAX_SEARCH_QUERY_LENGTH).optional(),
	page: z.number().int().positive().optional(),
	size: z.number().int().positive().max(MAX_PAGE_SIZE).optional(),
	charIds: z.array(z.string().min(1)).optional(),
	noCharacters: z.boolean().optional(),
	tagIds: z.array(z.string().min(1)).optional(),
	tagMode: tagFilterMode.optional(),
	colIds: z.array(z.string().min(1)).optional(),
	sortBy: sortBy.optional(),
	order: sortOrder.optional(),
	random: z.boolean().optional(),
	seed: z.string().optional(),
	traitFilters: z.array(traitFilter).optional(),
	contentPluginId: pluginManifestId.optional(),
	searchMetaFacets: z.record(z.string(), z.boolean()).optional(),
	searchIntro: z.boolean().optional(),
	relationshipTypeIds: z.array(z.string().min(1)).optional(),
	dislikedOnly: z.boolean().optional(),
})

export const listInput = listInputShape.default({})

/**
 * Card listing filtered by an explicit id set (bulk "only selected").
 * Served by mutation procedures so the ids ride in the POST body — the cap
 * is governed by the 1 MB body limit, not by URL/header size.
 */
export const listByIdsInput = listInputShape.extend({
	ids: z.array(z.string().min(1)).min(1).max(MAX_ID_FILTER_SIZE),
})
