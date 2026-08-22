import type { TraitDef } from "@hoardodile/schemas"

export type TraitRow = {
	readonly traitId: string
	readonly name: string
	readonly kind: TraitDef["kind"]
	readonly color: string
	readonly value: string
}

/**
 * Pair each defined trait with the character's value, dropping any trait
 * whose value is empty / whitespace. Includes kind and color so callers can
 * render trait chips consistently with the rest of the UI.
 */
export function buildTraitRows(
	traits: readonly TraitDef[],
	traitValues: Readonly<Record<string, string>>,
): readonly TraitRow[] {
	const rows: TraitRow[] = []
	for (const trait of traits) {
		const raw = traitValues[trait.id]
		const value = raw === undefined ? "" : raw.trim()
		if (value.length === 0) continue
		rows.push({
			traitId: trait.id,
			name: trait.name,
			kind: trait.kind,
			color: trait.color,
			value,
		})
	}
	return rows
}
