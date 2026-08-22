import type {
	ImageSearchResult,
	SearchGlobalInput,
	SearchGlobalResult,
} from "@hoardodile/schemas"
import { queryOptions } from "@tanstack/react-query"
import { apiFetch } from "@/lib/http"
import { apiPaths } from "@/lib/paths"
import { trpcQuery } from "@/trpc/factory"

export const searchKeys = {
	all: ["search"] as const,
	global: (input: SearchGlobalInput) =>
		[...searchKeys.all, "global", input] as const,
	imageSearch: (sessionId: string) =>
		[...searchKeys.all, "imageSearch", sessionId] as const,
} as const

export function globalSearchQueryOptions(input: SearchGlobalInput) {
	return queryOptions({
		queryKey: searchKeys.global(input),
		queryFn: () => trpcQuery("search", "global", input),
		staleTime: 2_000,
		enabled: input.query !== undefined && input.query.trim().length > 0,
	})
}

export function imageSearchQueryOptions(sessionId: string) {
	return queryOptions({
		queryKey: searchKeys.imageSearch(sessionId),
		queryFn: () => trpcQuery("resource", "imageSearch", { sessionId }),
		staleTime: 60_000,
	})
}

/**
 * Upload an image for reverse image search. The server stores it as a
 * query session (image + perceptual hashes) and answers with the
 * session id, which the caller hands to the `/search` page.
 */
export async function uploadImageSearchQuery(
	file: File,
): Promise<{ sessionId: string }> {
	const form = new FormData()
	form.append("file", file)
	const resp = await apiFetch(apiPaths.imageSearch.upload(), {
		method: "POST",
		body: form,
	})
	if (!resp.ok) {
		const body = (await resp.json().catch(() => undefined)) as
			| { error?: string }
			| undefined
		throw new Error(
			body?.error ?? `image search upload failed (${resp.status})`,
		)
	}
	return (await resp.json()) as { sessionId: string }
}

export type { ImageSearchResult, SearchGlobalInput, SearchGlobalResult }
