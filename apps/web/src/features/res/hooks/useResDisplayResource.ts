import type { ResCard as ResCardData } from "@hoardodile/schemas"
import { useQuery } from "@tanstack/react-query"
import { resDetailCardQueryOptions } from "@/features/res/api"

export type ResMediaThumbResource = Pick<
	ResCardData,
	| "id"
	| "name"
	| "contentPluginId"
	| "sourceMeta"
	| "coverMeta"
	| "searchMeta"
	| "fileStats"
	| "updatedAt"
>

/** Meta fields merged from {@link resDetailCardQueryOptions} into list-card props. */
export type ResDisplayMetaFields = Pick<
	ResMediaThumbResource,
	"coverMeta" | "sourceMeta" | "searchMeta" | "fileStats" | "updatedAt"
>

export function needsResMeta(
	resource: Pick<
		ResMediaThumbResource,
		"contentPluginId" | "coverMeta" | "sourceMeta"
	>,
): boolean {
	return (
		resource.contentPluginId !== null &&
		(resource.coverMeta === undefined || resource.sourceMeta === undefined)
	)
}

export function mergeResMetaFields<T extends ResMediaThumbResource>(
	base: T,
	fresh: ResDisplayMetaFields,
): T {
	return {
		...base,
		...(fresh.coverMeta !== undefined ? { coverMeta: fresh.coverMeta } : {}),
		...(fresh.sourceMeta !== undefined ? { sourceMeta: fresh.sourceMeta } : {}),
		...(fresh.searchMeta !== undefined ? { searchMeta: fresh.searchMeta } : {}),
		...(fresh.fileStats !== undefined ? { fileStats: fresh.fileStats } : {}),
		...(fresh.updatedAt !== undefined ? { updatedAt: fresh.updatedAt } : {}),
	}
}

/**
 * When a list-card prop is missing derived meta, subscribe to
 * `resource.detailCard` and overlay meta fields for display. Mirrors the
 * detail-page sidebar pattern without invalidating list queries.
 */
export function useResDisplayResource<T extends ResMediaThumbResource>(
	resource: T,
): T {
	const enabled = needsResMeta(resource)
	const detailQuery = useQuery({
		...resDetailCardQueryOptions(resource.id),
		enabled,
		staleTime: 30_000,
	})
	const fresh = detailQuery.data
	if (!enabled || fresh === undefined) return resource
	return mergeResMetaFields(resource, fresh)
}
