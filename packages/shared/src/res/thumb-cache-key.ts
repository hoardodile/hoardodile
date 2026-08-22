/**
 * Stable cache-buster for resource cover/thumbnail URLs.
 *
 * Uses the resource's `updatedAt`. Cover writes/deletes bump `updatedAt`,
 * so the URL changes and the browser fetches the new thumbnail. Background
 * meta rebuilds do not touch `updatedAt`, so they do not refetch unchanged
 * thumbnails.
 */
export function buildResThumbCacheKey(input: {
	readonly updatedAt: number
}): string {
	return String(input.updatedAt)
}
