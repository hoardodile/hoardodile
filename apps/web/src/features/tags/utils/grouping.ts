import type { Category, CatKind, Tag } from "@hoardodile/schemas"

/**
 * Pure helpers for grouping/filtering tags by category, used by the
 * tag picker and category-tag panels. All functions are pure: they
 * never mutate inputs and return fresh references on every call.
 */

/**
 * Filter `categories` to those visible for `kind`.
 *
 * When `kind` is `undefined`, returns all categories.
 * When `kind === "common"`, returns only common categories.
 * Otherwise returns `kind`-specific categories plus common ones (which
 * are shared across contexts). Result is sorted by `position`.
 */
export function filterCategoriesByKind(
	categories: readonly Category[],
	kind: CatKind | undefined,
): readonly Category[] {
	const filtered =
		kind === undefined
			? categories
			: kind === "common"
				? categories.filter((c) => c.kind === "common")
				: categories.filter((c) => c.kind === kind || c.kind === "common")
	return filtered.slice().sort((a, b) => {
		if (a.kind !== b.kind) {
			if (a.kind === "common") return -1
			if (b.kind === "common") return 1
		}
		return a.position - b.position
	})
}

/**
 * Group `tags` into buckets keyed by `catId`. Tags without a
 * category are dropped. Each bucket is sorted by `position`, then `id` for
 * a stable display order.
 */
export function groupTagsByCategory(
	tags: readonly Tag[],
): Map<string, readonly Tag[]> {
	const map = new Map<string, Tag[]>()
	for (const tag of tags) {
		if (tag.catId === undefined) continue
		const existing = map.get(tag.catId)
		if (existing !== undefined) existing.push(tag)
		else map.set(tag.catId, [tag])
	}
	for (const bucket of map.values()) {
		bucket.sort(
			(a, b) => a.position - b.position || a.name.localeCompare(b.name),
		)
	}
	return map
}

export type SelectedTagGroup = {
	readonly category: Category
	readonly tags: readonly Tag[]
}

/**
 * Project the current selection into a `[category, tags[]]` view used
 * by selection summaries. Categories are processed in the order they
 * appear in `categories`; categories with no selected tags are omitted.
 */
export function buildSelectedTagGroups(
	categories: readonly Category[],
	allTags: readonly Tag[],
	selectedIds: ReadonlySet<string>,
): readonly SelectedTagGroup[] {
	const groups: SelectedTagGroup[] = []
	for (const cat of categories) {
		const tags = allTags
			.filter((t) => t.catId === cat.id && selectedIds.has(t.id))
			.slice()
			.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
		if (tags.length > 0) groups.push({ category: cat, tags })
	}
	return groups
}
