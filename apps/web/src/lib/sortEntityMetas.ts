import type { EntityMetaSortable } from "@hoardodile/schemas"
import { applyOrderOverride } from "./applyOrderOverride"

export type SortableEntityMeta = EntityMetaSortable & { readonly id: string }

function comparePositionName(
	a: EntityMetaSortable,
	b: EntityMetaSortable,
): number {
	if (a.position !== b.position) return a.position - b.position
	return a.name.localeCompare(b.name)
}

/**
 * Canonical display order for entity-meta lists on the management panels:
 * by `position`, then alphabetically by `name`. Pinning does not affect
 * display order; order is independent of the pinned flag.
 * When `orderIds` is provided (optimistic reorder override), it is applied
 * on top of the sorted base list.
 */
export function sortEntityMetas<T extends SortableEntityMeta>(
	items: readonly T[],
	orderIds: readonly string[] | undefined,
): readonly T[] {
	const base = [...items].sort(comparePositionName)
	return applyOrderOverride(base, orderIds)
}
