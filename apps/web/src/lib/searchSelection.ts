/**
 * Generic selection model used by search/picker views (resources, characters,
 * etc.). Each picker can run in `multi` mode (checkboxes, returns id list) or
 * `single` mode (radio, returns one id). Per-card state is computed by
 * {@link resolveCardSelection}; toggling membership in a multi-select is
 * delegated to {@link toggleSelectionMembership}.
 */

export type SearchMultiSelection = {
	readonly mode: "multi"
	readonly selected: readonly string[]
	readonly onChange: (ids: readonly string[]) => void
}

export type SearchSingleSelection = {
	readonly mode: "single"
	readonly selected: string | undefined
	readonly onChange: (id: string) => void
}

export type SearchSelection = SearchMultiSelection | SearchSingleSelection

export type CardSelectionState = {
	readonly selected: boolean
	readonly onToggle: () => void
}

/**
 * Add `id` to a multi-select set, or remove it when already present, then
 * publish the new id list back through `selection.onChange`.
 */
export function toggleSelectionMembership(
	selection: SearchMultiSelection,
	id: string,
): void {
	const next = new Set(selection.selected)
	if (next.has(id)) next.delete(id)
	else next.add(id)
	selection.onChange([...next])
}

/**
 * Compute the per-card selection state passed down to a card component.
 * Returns `undefined` when the picker is in browse mode (no selection
 * concept), so the card hides its checkbox/radio entirely.
 */
export function resolveCardSelection(
	selection: SearchSelection | undefined,
	id: string,
): CardSelectionState | undefined {
	if (selection === undefined) return undefined
	if (selection.mode === "multi") {
		return {
			selected: selection.selected.includes(id),
			onToggle: () => toggleSelectionMembership(selection, id),
		}
	}
	return {
		selected: selection.selected === id,
		onToggle: () => selection.onChange(id),
	}
}
