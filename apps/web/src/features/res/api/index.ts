import type { ResCard } from "@hoardodile/schemas"
import { DEFAULT_PAGE_SIZE } from "@hoardodile/schemas/page"
import type { PluginManifestId } from "@hoardodile/sdk-types"
import type {
	ListPageResult,
	SortBy,
	SortOrder,
	TagFilterMode,
} from "@hoardodile/shared"
import { queryOptions } from "@tanstack/react-query"
import { DEFAULT_TIME_ZONE } from "@/features/settings/datePrefs"
import { apiPutBlob } from "@/lib/http"
import { prefKeys } from "@/lib/keys"
import {
	nonEmptyArray,
	nonEmptyRecord,
	nonEmptyString,
	trueOrUndefined,
} from "@/lib/listPayload"
import { makeInvalidator } from "@/lib/makeInvalidator"
import { apiPaths } from "@/lib/paths"
import { prefSync } from "@/lib/prefSync"
import { normalizeTimeZonePref, resolveBrowserTimeZone } from "@/lib/timezone"
import { idMutation, trpcMutate, trpcMutation, trpcQuery } from "@/trpc/factory"

export type ResListKeyInput = {
	readonly trash: boolean
	readonly query: string
	readonly page: number
	readonly charIds?: readonly string[]
	readonly noCharacters?: boolean
	readonly tagIds?: readonly string[]
	readonly tagMode?: TagFilterMode
	readonly sortBy?: SortBy
	readonly order?: SortOrder
	readonly random?: boolean
	readonly seed?: string
	readonly ids?: readonly string[]
	readonly dislikedOnly?: boolean
}

export const resKeys = {
	all: ["resource"] as const,
	list: (input: ResListKeyInput) => [...resKeys.all, "list", input] as const,
	listCards: (input: ResListKeyInput) =>
		[...resKeys.all, "listCards", input] as const,
	listCardsByIds: (input: ResListKeyInput) =>
		[...resKeys.all, "listCardsByIds", input] as const,
	detail: (id: string) => [...resKeys.all, "detail", id] as const,
	detailCard: (id: string) => [...resKeys.all, "detailCard", id] as const,
	preview: (id: string) => [...resKeys.all, "preview", id] as const,
	files: (id: string) => [...resKeys.all, "files", id] as const,
	relatedByTags: (id: string, limit: number) =>
		[...resKeys.all, "relatedByTags", id, limit] as const,
	similarImages: (id: string) => [...resKeys.all, "similarImages", id] as const,
	similarWithin: (id: string) => [...resKeys.all, "similarWithin", id] as const,
	duplicateImages: (id: string) =>
		[...resKeys.all, "duplicateImages", id] as const,
	imageSearch: (sessionId: string) =>
		[...resKeys.all, "imageSearch", sessionId] as const,
	memories: (input: ResMemoriesInput) =>
		[...resKeys.all, "memories", input] as const,
	sourceNames: (limit: number) =>
		[...resKeys.all, "sourceNames", limit] as const,
} as const

export type ResMemoriesInput = {
	readonly month: number
	readonly day: number
	readonly offsetMin: number
}

export const importKeys = {
	all: ["import"] as const,
	config: () => [...importKeys.all, "config"] as const,
	browseDirectory: (root: string, subPath: string) =>
		[...importKeys.all, "browseDirectory", root, subPath] as const,
} as const

export type ResCardListResult = ListPageResult<ResCard>

export const RESOURCE_PAGE_SIZE = DEFAULT_PAGE_SIZE

type ResListOptions = {
	readonly query: string
	readonly page: number
	readonly size?: number
	readonly charIds?: readonly string[]
	readonly noCharacters?: boolean
	readonly tagIds?: readonly string[]
	readonly tagMode?: TagFilterMode
	readonly sortBy?: SortBy
	readonly order?: SortOrder
	readonly random?: boolean
	readonly seed?: string
	readonly contentPluginId?: PluginManifestId
	readonly sourceName?: string
	readonly searchMetaFacets?: Record<string, boolean>
	readonly searchIntro?: boolean
	readonly dislikedOnly?: boolean
}

function buildResourceListPayload(input: ResListOptions) {
	const {
		query,
		page,
		size,
		charIds,
		noCharacters,
		tagIds,
		tagMode,
		sortBy,
		order,
		random,
		seed,
		contentPluginId,
		sourceName,
		searchMetaFacets,
		searchIntro,
		dislikedOnly,
	} = input
	return {
		query: nonEmptyString(query),
		page,
		size: size ?? RESOURCE_PAGE_SIZE,
		charIds: nonEmptyArray(charIds),
		noCharacters: trueOrUndefined(noCharacters),
		tagIds: nonEmptyArray(tagIds),
		tagMode,
		sortBy,
		order,
		random,
		seed,
		contentPluginId,
		sourceName,
		searchMetaFacets: nonEmptyRecord(searchMetaFacets),
		searchIntro: trueOrUndefined(searchIntro),
		dislikedOnly: trueOrUndefined(dislikedOnly),
	}
}

export function resListCardsQueryOptions(
	input: ResListOptions & { readonly trash?: boolean },
) {
	const { trash, ...rest } = input
	return queryOptions({
		queryKey: resKeys.listCards({ trash: trash ?? false, ...rest }),
		queryFn: () => fetchResourceListCards(input),
		staleTime: 2_000,
	})
}

export function fetchResourceListCards(
	input: ResListOptions & { readonly trash?: boolean },
): Promise<ResCardListResult> {
	const { trash, ...rest } = input
	const payload = buildResourceListPayload(rest)
	return trash === true
		? trpcQuery("resource", "trashListCards", payload)
		: trpcQuery("resource", "listCards", payload)
}

/**
 * Bulk "only selected" listing. Backed by the `listCardsByIds` mutations so
 * a large id set travels in the POST body instead of the GET URL; the plain
 * `listCards` queries stay GET-only.
 */
export function fetchResourceListCardsByIds(
	input: ResListOptions & {
		readonly trash?: boolean
		readonly ids: readonly string[]
	},
): Promise<ResCardListResult> {
	const { trash, ids, ...rest } = input
	const payload = { ...buildResourceListPayload(rest), ids: [...ids] }
	return trash === true
		? trpcMutate("resource", "trashListCardsByIds", payload)
		: trpcMutate("resource", "listCardsByIds", payload)
}

export function fetchResourceMemories(
	input: ResMemoriesInput,
): Promise<ResCard[]> {
	return trpcQuery("resource", "memories", input)
}

export function resMemoriesQueryOptions(input: ResMemoriesInput) {
	return queryOptions({
		queryKey: resKeys.memories(input),
		queryFn: () => fetchResourceMemories(input),
		staleTime: 60_000,
	})
}

export type SourceNameCount = {
	readonly name: string
	readonly count: number
}

const SOURCE_NAMES_LIMIT = 50

export function resSourceNamesQueryOptions() {
	return queryOptions({
		queryKey: resKeys.sourceNames(SOURCE_NAMES_LIMIT),
		queryFn: () =>
			trpcQuery("resource", "sourceNames", { limit: SOURCE_NAMES_LIMIT }),
		staleTime: 60_000,
	})
}

/**
 * Query-options wrapper around {@link fetchResourceListCardsByIds} for the
 * "only selected" view. Disabled for an empty id set — the server requires
 * at least one id.
 */
export function resListCardsByIdsQueryOptions(
	input: ResListOptions & {
		readonly trash?: boolean
		readonly ids: readonly string[]
	},
) {
	const { trash, ids, ...rest } = input
	return queryOptions({
		queryKey: resKeys.listCardsByIds({ trash: trash ?? false, ids, ...rest }),
		queryFn: () => fetchResourceListCardsByIds(input),
		enabled: ids.length > 0,
		staleTime: 2_000,
	})
}

export function resDetailQueryOptions(id: string) {
	return queryOptions({
		queryKey: resKeys.detail(id),
		queryFn: () => trpcQuery("resource", "detail", { id }),
		staleTime: 2_000,
	})
}

export function resDetailCardQueryOptions(id: string) {
	return queryOptions({
		queryKey: resKeys.detailCard(id),
		queryFn: () => trpcQuery("resource", "detailCard", { id }),
		staleTime: 2_000,
	})
}

export const invalidateResources = makeInvalidator({
	all: resKeys.all,
	detail: resKeys.detail,
})

export function resFilesQueryOptions(id: string) {
	return queryOptions({
		queryKey: resKeys.files(id),
		queryFn: () => trpcQuery("resource", "listFiles", { id }),
		staleTime: Number.POSITIVE_INFINITY,
	})
}

export function relatedResourcesByTagsQueryOptions(id: string, limit: number) {
	return queryOptions({
		queryKey: resKeys.relatedByTags(id, limit),
		queryFn: () => trpcQuery("resource", "relatedByTags", { id, limit }),
		staleTime: 30_000,
	})
}

export function similarImagesQueryOptions(id: string) {
	return queryOptions({
		queryKey: resKeys.similarImages(id),
		queryFn: () => trpcQuery("resource", "similarImages", { id }),
		staleTime: 30_000,
	})
}

export function similarWithinQueryOptions(id: string) {
	return queryOptions({
		queryKey: resKeys.similarWithin(id),
		queryFn: () => trpcQuery("resource", "similarWithinResource", { id }),
		staleTime: 30_000,
	})
}

export function duplicateImagesQueryOptions(id: string) {
	return queryOptions({
		queryKey: resKeys.duplicateImages(id),
		queryFn: () => trpcQuery("resource", "duplicateImages", { id }),
		staleTime: 30_000,
	})
}

export function imageSearchQueryOptions(sessionId: string) {
	return queryOptions({
		queryKey: resKeys.imageSearch(sessionId),
		queryFn: () => trpcQuery("resource", "imageSearch", { sessionId }),
		staleTime: 60_000,
	})
}

export function createResourceWithUploadMutation() {
	return trpcMutation("resource", "create", {
		transform: (input: {
			files?: readonly string[]
			names?: readonly string[]
			archiveFileId?: string
			filename?: string
			name?: string
			intro?: string
			sourceName?: string
			sourceUrl?: string
			contentPluginId?: PluginManifestId
			tagIds?: readonly string[]
			charIds?: readonly string[]
			defaultNameTimeZone?: string
		}) => ({
			...input,
			defaultNameTimeZone:
				input.defaultNameTimeZone ??
				resolveBrowserTimeZone(
					normalizeTimeZonePref(
						prefSync.get(prefKeys.timeZone) ?? DEFAULT_TIME_ZONE,
					),
				),
			tagIds: nonEmptyArray(input.tagIds),
			charIds: nonEmptyArray(input.charIds),
			files: input.files ? [...input.files] : undefined,
			names: input.names ? [...input.names] : undefined,
		}),
	})
}

export function updateResourceMutation() {
	return trpcMutation("resource", "update", {
		transform: (input: {
			id: string
			name?: string
			intro?: string
			sourceName?: string
			sourceUrl?: string
			charIds?: readonly string[]
		}) => ({
			...input,
			charIds: nonEmptyArray(input.charIds),
		}),
	})
}

export function softDeleteResourceMutation() {
	return idMutation("resource", "softDelete")
}

export function restoreResourceMutation() {
	return idMutation("resource", "restore")
}

export function hardDeleteResourceMutation() {
	return idMutation("resource", "hardDelete")
}

export function softDeleteManyResourcesMutation() {
	return trpcMutation("resource", "softDeleteMany", {
		transform: (ids: readonly string[]) => ({
			ids: nonEmptyArray(ids) ?? [],
		}),
	})
}

export function hardDeleteManyResourcesMutation() {
	return trpcMutation("resource", "hardDeleteMany", {
		transform: (ids: readonly string[]) => ({
			ids: nonEmptyArray(ids) ?? [],
		}),
	})
}

export function setResourceContentPluginIdMutation() {
	return trpcMutation("resource", "setContentPluginId")
}

export function resDislikeMutation() {
	return trpcMutation("resource", "dislike")
}

// ── Non-tRPC HTTP endpoints ─────────────────────────────────────────────────

export async function uploadResCover(
	resId: string,
	blob: Blob,
	filename: string,
	contentType?: string,
): Promise<void> {
	const response = await apiPutBlob(
		apiPaths.resources.cover(resId),
		blob,
		filename,
		contentType,
	)
	if (!response.ok) {
		const text = await response.text().catch(() => "")
		throw new Error(text || `cover upload failed (${response.status})`)
	}
}

export function resFileUrl(resId: string, filename: string): string {
	return apiPaths.resources.files(resId, filename)
}

export function resSourceZipUrl(resId: string): string {
	return apiPaths.resources.sourceZip(resId)
}

export async function bulkDownloadResources(
	ids: readonly string[],
	options: { readonly dateStamp: string },
): Promise<Response> {
	return fetch(apiPaths.resources.bulkSourceZip(), {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			ids: [...ids],
			sortByCreated: true,
			dateStamp: options?.dateStamp,
		}),
	})
}
