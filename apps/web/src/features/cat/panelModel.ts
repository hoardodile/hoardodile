import type { Category, CatKind, Tag } from "@hoardodile/schemas"
import { groupTagsByCategory } from "@/features/tags/utils/grouping"

/**
 * Kinds shown as top-level tabs in the panel. Order is meaningful — it
 * controls tab order in the UI.
 */
export const CATEGORY_KIND_TABS = [
	"common",
	"resource",
	"character",
] as const satisfies readonly CatKind[]

export type TagWithCounts = Tag & {
	readonly resCount: number
	readonly charCount: number
}

export type CatWithCounts = Category & { readonly tagCount: number }

/** A tag is unused when nothing uses it — no resource and no character
    links. Sibling members are never "unused". */
export function tagHasNoCharOrResUsage(tag: {
	readonly charCount: number
	readonly resCount: number
}): boolean {
	return tag.charCount === 0 && tag.resCount === 0
}

/** Type guard for `CatKind`. */
export function isCategoryKind(value: string): value is CatKind {
	for (const kind of CATEGORY_KIND_TABS) {
		if (kind === value) return true
	}
	return false
}

function comparePositionName(a: TagWithCounts, b: TagWithCounts): number {
	if (a.position !== b.position) return a.position - b.position
	return a.name.localeCompare(b.name)
}

/**
 * Bucket tags by category id. Tags are guaranteed to have a `catId`
 * (uncategorized tags are not allowed). Each bucket is sorted by
 * `position`, then by `name` for a stable display order. Pinning does
 * not affect display order; order is independent of the pinned flag.
 */
export function groupTagsByCategoryWithCounts(
	tags: readonly TagWithCounts[],
): ReadonlyMap<string, readonly TagWithCounts[]> {
	const map = groupTagsByCategory(tags) as Map<string, TagWithCounts[]>
	for (const [key, list] of map) {
		map.set(key, list.slice().sort(comparePositionName))
	}
	return map
}
