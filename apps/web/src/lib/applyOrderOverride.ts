import { keyBy } from "es-toolkit"

/**
 * Reorder `list` to match `ids` when every id is present exactly once.
 * Used for optimistic UI while a reorder mutation is in flight.
 */
export function applyOrderOverride<T extends { readonly id: string }>(
	list: readonly T[],
	ids: readonly string[] | undefined,
): readonly T[] {
	if (ids === undefined || ids.length === 0) return list
	const byId = keyBy(list, (x) => x.id)
	const out: T[] = []
	for (const id of ids) {
		const item = byId[id]
		if (item !== undefined) out.push(item)
	}
	return out.length === list.length ? out : list
}
