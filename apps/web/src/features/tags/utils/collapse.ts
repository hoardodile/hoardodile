/**
 * Display-collapse for tag lists (M2): sibling groups render as their
 * display tag everywhere. `byId` must hold every display tag (the full
 * tag list does); members are replaced by their display row, duplicates
 * collapse, and order follows first occurrence. Storage keeps the real
 * tags — this is purely the rendering view.
 */
export function collapseTags<
	T extends { readonly id: string; readonly displayTagId: string },
>(tags: readonly T[], byId: ReadonlyMap<string, T>): readonly T[] {
	const seen = new Set<string>()
	const collapsed: T[] = []
	for (const tag of tags) {
		const display = byId.get(tag.displayTagId) ?? tag
		if (seen.has(display.id)) continue
		seen.add(display.id)
		collapsed.push(display)
	}
	return collapsed
}
