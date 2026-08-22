import type { DocNode } from "@hoardodile/schemas"

/**
 * Adjacency-list tree built from the flat live-nodes payload returned
 * by `document.tree`. Children are sorted by `position` then `createdAt`
 * for stable display order; the implicit root has `parentId === undefined`.
 */
export type DocTreeNode = {
	readonly node: DocNode
	readonly children: readonly DocTreeNode[]
}

/**
 * Build a sorted adjacency-list tree from a flat live-nodes payload.
 *
 * Pure: returns a fresh tree on every call; never mutates `flat` or the
 * nodes it contains. Stable sort by `position` (descending), then
 * `createdAt` (descending) so newly-created nodes — which the server
 * assigns the next-highest position — surface at the top of each
 * sibling list.
 */
export function buildDocumentTree(
	flat: readonly DocNode[],
): readonly DocTreeNode[] {
	const byParent = new Map<string | undefined, DocNode[]>()
	for (const node of flat) {
		const key = node.parentId
		const list = byParent.get(key)
		if (list === undefined) byParent.set(key, [node])
		else list.push(node)
	}
	for (const list of byParent.values()) {
		list.sort((a, b) => b.position - a.position || b.createdAt - a.createdAt)
	}
	function pack(parentId: string | undefined): readonly DocTreeNode[] {
		const list = byParent.get(parentId) ?? []
		return list.map((node) => ({ node, children: pack(node.id) }))
	}
	return pack(undefined)
}

/**
 * Collect every node id that has at least one child, i.e. can be expanded
 * or collapsed by the tree UI.
 */
export function collectExpandableIds(
	nodes: readonly DocTreeNode[],
): Set<string> {
	const set = new Set<string>()
	function walk(list: readonly DocTreeNode[]) {
		for (const n of list) {
			if (n.children.length > 0) {
				set.add(n.node.id)
			}
			walk(n.children)
		}
	}
	walk(nodes)
	return set
}
