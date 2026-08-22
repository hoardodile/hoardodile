import type { DocNode } from "@hoardodile/schemas"
import { useCallback, useMemo } from "react"
import { usePref } from "@/hooks/usePref"
import { prefKeys } from "@/lib/keys"
import { buildDocumentTree, collectExpandableIds } from "../utils/buildDocTree"

export type UseDocTreeExpansionResult = {
	readonly expandedIds: ReadonlySet<string>
	readonly allExpanded: boolean
	/** Whether the tree contains at least one expandable folder. */
	readonly hasExpandableNodes: boolean
	readonly toggleExpanded: (id: string) => void
	readonly expandIds: (ids: Iterable<string>) => void
	readonly toggleExpandAll: () => void
}

/**
 * Owns the tree expansion state for the documents sidebar, persisted
 * through the `docTreeExpanded` preference. Stored ids that no longer
 * exist in the tree are dropped; expand-all toggles across the current
 * set of expandable folders.
 */
export function useDocTreeExpansion(
	nodes: readonly DocNode[],
): UseDocTreeExpansionResult {
	const [expandedRaw, setExpandedRaw] = usePref(
		prefKeys.docTreeExpanded,
		[] as readonly string[],
	)
	const tree = useMemo(() => buildDocumentTree(nodes), [nodes])
	const allExpandableIds = useMemo(() => collectExpandableIds(tree), [tree])
	const expandedIds = useMemo(() => {
		const next = new Set<string>()
		for (const id of expandedRaw) {
			if (allExpandableIds.has(id)) next.add(id)
		}
		return next
	}, [expandedRaw, allExpandableIds])

	const allExpanded =
		allExpandableIds.size > 0 && expandedIds.size === allExpandableIds.size

	const toggleExpanded = useCallback(
		function toggleExpanded(id: string) {
			const next = new Set(expandedIds)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			setExpandedRaw([...next])
		},
		[expandedIds, setExpandedRaw],
	)

	const expandIds = useCallback(
		function expandIds(ids: Iterable<string>) {
			const next = new Set(expandedIds)
			let changed = false
			for (const id of ids) {
				if (!next.has(id)) {
					next.add(id)
					changed = true
				}
			}
			if (changed) setExpandedRaw([...next])
		},
		[expandedIds, setExpandedRaw],
	)

	const toggleExpandAll = useCallback(
		function toggleExpandAll() {
			if (allExpanded) setExpandedRaw([])
			else setExpandedRaw([...allExpandableIds])
		},
		[allExpanded, allExpandableIds, setExpandedRaw],
	)

	return {
		expandedIds,
		allExpanded,
		hasExpandableNodes: allExpandableIds.size > 0,
		toggleExpanded,
		expandIds,
		toggleExpandAll,
	}
}
