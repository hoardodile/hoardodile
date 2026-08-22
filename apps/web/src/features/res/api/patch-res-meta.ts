import type {
	ResCard,
	Resource,
	ResourceMetaSnapshot,
} from "@hoardodile/schemas"
import { produce } from "@hoardodile/shared/immer"
import type { QueryClient } from "@tanstack/react-query"
import { type ResCardListResult, resKeys } from "./index"

function isListCardsQueryKey(queryKey: readonly unknown[]): boolean {
	return queryKey[0] === resKeys.all[0] && queryKey[1] === "listCards"
}

function applyMetaSnapshot<T extends Resource>(
	card: T,
	meta: ResourceMetaSnapshot,
): T {
	return produce(card, (draft) => {
		if ("coverMeta" in meta) {
			if (meta.coverMeta === null) delete draft.coverMeta
			else if (meta.coverMeta !== undefined) draft.coverMeta = meta.coverMeta
		}
		if ("sourceMeta" in meta) {
			if (meta.sourceMeta === null) delete draft.sourceMeta
			else if (meta.sourceMeta !== undefined) draft.sourceMeta = meta.sourceMeta
		}
		if ("searchMeta" in meta) {
			if (meta.searchMeta === null) delete draft.searchMeta
			else if (meta.searchMeta !== undefined) draft.searchMeta = meta.searchMeta
		}
		if ("fileStats" in meta) {
			if (meta.fileStats === null) delete draft.fileStats
			else if (meta.fileStats !== undefined) draft.fileStats = meta.fileStats
		}
	})
}

/** Merge meta fields into detail/detailCard caches for one resource. */
export function patchResMetaInDetailCaches(
	queryClient: QueryClient,
	resourceId: string,
	meta: ResourceMetaSnapshot,
): void {
	queryClient.setQueryData<Resource>(resKeys.detail(resourceId), (old) =>
		old === undefined ? old : applyMetaSnapshot(old, meta),
	)
	queryClient.setQueryData<ResCard>(resKeys.detailCard(resourceId), (old) =>
		old === undefined ? old : applyMetaSnapshot(old, meta),
	)
}

/** Patch meta fields into every cached listCards page containing the resource. */
export function patchResMetaInListCaches(
	queryClient: QueryClient,
	resourceId: string,
	meta: ResourceMetaSnapshot,
): void {
	queryClient.setQueriesData<ResCardListResult>(
		{
			predicate: (query) => isListCardsQueryKey(query.queryKey),
		},
		(old) => {
			if (old === undefined) return old
			const index = old.rows.findIndex((row) => row.id === resourceId)
			if (index < 0) return old
			const nextRow = applyMetaSnapshot(old.rows[index]!, meta)
			const rows = old.rows.slice()
			rows[index] = nextRow
			return { ...old, rows }
		},
	)
}

export function patchResMetaInCache(
	queryClient: QueryClient,
	resourceId: string,
	meta: ResourceMetaSnapshot,
): void {
	patchResMetaInDetailCaches(queryClient, resourceId, meta)
	patchResMetaInListCaches(queryClient, resourceId, meta)
}
