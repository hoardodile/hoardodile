import type { Category, Tag } from "@hoardodile/schemas"
import { sortBy } from "es-toolkit"

export type TagGroup = {
	readonly catId: string
	readonly catName: string
	readonly catColor: string
	readonly tags: readonly Tag[]
}

/**
 * Group tags by their category, preserving category order.
 * Empty categories are filtered out so the caller can skip rendering them.
 */
export function buildTagGroups(
	tags: readonly Tag[],
	categories: readonly Category[],
): readonly TagGroup[] {
	const sortedCategories = sortBy([...categories], [(c) => c.position])
	const map = new Map<string, Tag[]>()
	for (const tag of tags) {
		const list = map.get(tag.catId)
		if (list === undefined) map.set(tag.catId, [tag])
		else list.push(tag)
	}

	const groups: TagGroup[] = []
	for (const cat of sortedCategories) {
		const list = map.get(cat.id)
		if (list === undefined || list.length === 0) continue
		list.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
		groups.push({
			catId: cat.id,
			catName: cat.name,
			catColor: cat.color,
			tags: list,
		})
	}

	return groups
}
