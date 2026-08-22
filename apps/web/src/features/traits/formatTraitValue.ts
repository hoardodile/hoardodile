import { parseTraitValue } from "@hoardodile/schemas"
import type { TraitRow } from "./buildTraitRows"

export function formatTraitValue(
	row: Pick<TraitRow, "kind" | "value">,
	formatDateTrait: (parsed: {
		readonly prefix: string
		readonly sign: "+" | "-"
		readonly year: number | undefined
		readonly month: number | undefined
		readonly day: number | undefined
	}) => string,
): string {
	if (row.kind !== "date") return row.value
	try {
		const parsed = parseTraitValue("date", row.value)
		if (parsed.kind !== "date") return row.value
		return formatDateTrait(parsed)
	} catch {
		return row.value
	}
}
