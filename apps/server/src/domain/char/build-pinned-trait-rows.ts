import { comparePinnedPositionName } from "@hoardodile/schemas/entity-meta"
import type { TraitDef, TraitKind } from "@hoardodile/schemas/trait"

export type PinnedTraitRow = {
	readonly id: string
	readonly name: string
	readonly color: string
	readonly kind: TraitKind
	readonly value: string
}

/**
 * Pair pinned trait definitions with non-empty character values, sorted
 * by pinned → position → name.
 */
export function buildPinnedTraitRows(
	traits: readonly TraitDef[],
	traitValues: Readonly<Record<string, string>>,
): readonly PinnedTraitRow[] {
	const rows: PinnedTraitRow[] = []
	const pinnedTraits = [...traits]
		.filter((trait) => trait.pinned)
		.sort(comparePinnedPositionName)
	for (const trait of pinnedTraits) {
		const raw = traitValues[trait.id]
		const value = raw === undefined ? "" : raw.trim()
		if (value.length === 0) continue
		rows.push({
			id: trait.id,
			name: trait.name,
			color: trait.color,
			kind: trait.kind,
			value,
		})
	}
	return rows
}
