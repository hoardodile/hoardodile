import { queryOptions } from "@tanstack/react-query"
import { apiFetch } from "@/lib/http"
import { apiPaths } from "@/lib/paths"

export type ClearCacheResult = {
	readonly cleared: boolean
	/** Cache entries that could not be deleted because they are locked. */
	readonly failed: readonly string[]
}

function isClearCacheResult(value: unknown): value is ClearCacheResult {
	if (typeof value !== "object" || value === null) return false
	if (!("cleared" in value) || typeof value.cleared !== "boolean") return false
	if (!("failed" in value) || !Array.isArray(value.failed)) return false
	return true
}

export async function clearCache(): Promise<ClearCacheResult> {
	const res = await apiFetch(apiPaths.cache.root(), { method: "DELETE" })
	if (!res.ok) throw new Error(`${res.status}`)
	const body: unknown = await res.json()
	if (!isClearCacheResult(body)) {
		throw new Error("Unexpected clear-cache response")
	}
	return body
}

export type TrashItem = {
	readonly name: string
	readonly kind: "resource" | "character" | "db"
	readonly originalId?: string
	readonly trashedAt?: number
	readonly coverUrl?: string
	readonly contentPluginId?: string
	readonly fileStats?: { sizeBytes?: number; count?: number }
	readonly files?: readonly unknown[]
}

export type TrashListResult = {
	readonly items: readonly TrashItem[]
}

export async function trashList(): Promise<TrashListResult> {
	const res = await apiFetch(apiPaths.cache.trash())
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string }
		throw new Error(body.error ?? `${res.status}`)
	}
	const result = (await res.json()) as TrashListResult
	const sortedItems = result.items.slice().sort((a, b) => {
		const aTime = a.trashedAt ?? 0
		const bTime = b.trashedAt ?? 0
		if (aTime !== bTime) return bTime - aTime
		return a.name.localeCompare(b.name)
	})
	return { ...result, items: sortedItems }
}

export function trashDownloadUrl(name: string): string {
	return apiPaths.cache.trashDownload(name)
}

export async function precacheStart(): Promise<Response> {
	return apiFetch(apiPaths.precache.start(), {
		method: "POST",
		headers: { Accept: "text/event-stream" },
	})
}

export async function precacheAbort(): Promise<Response> {
	return apiFetch(apiPaths.precache.abort(), { method: "POST" })
}

export async function precacheStream(): Promise<Response> {
	return apiFetch(apiPaths.precache.stream(), {
		headers: { Accept: "text/event-stream" },
	})
}

export const trashKeys = {
	all: ["trash"] as const,
	list: () => [...trashKeys.all, "list"] as const,
}

export function trashListQueryOptions() {
	return queryOptions({
		queryKey: trashKeys.list(),
		queryFn: async (): Promise<TrashListResult> => trashList(),
		staleTime: 5_000,
	})
}
