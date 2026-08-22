import type { ResourceMetaUpdatedEvent } from "@hoardodile/schemas"
import type { QueryClient } from "@tanstack/react-query"
import { resKeys } from "./index"
import { patchResMetaInCache } from "./patch-res-meta"

export function handleResourceMetaUpdated(
	queryClient: QueryClient,
	event: ResourceMetaUpdatedEvent,
): void {
	const { resourceId: id, meta, metaTypes } = event

	if (metaTypes.includes("imageHashes")) {
		// Hash rows live in separate queries — refetch them so the
		// similar/duplicate sections reflect the finished rebuild.
		void queryClient.invalidateQueries({
			queryKey: [resKeys.similarImages(id)[0], "similarImages", id],
		})
		void queryClient.invalidateQueries({
			queryKey: [resKeys.similarWithin(id)[0], "similarWithin", id],
		})
		void queryClient.invalidateQueries({
			queryKey: [resKeys.duplicateImages(id)[0], "duplicateImages", id],
		})
	}

	if (meta !== undefined && Object.keys(meta).length > 0) {
		patchResMetaInCache(queryClient, id, meta)
	}
}
