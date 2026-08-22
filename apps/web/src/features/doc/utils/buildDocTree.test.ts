/**
 * @vitest-environment node
 */

import type { DocNode } from "@hoardodile/schemas"
import { describe, expect, it } from "vitest"
import { buildDocumentTree } from "./buildDocTree"

function makeNode(
	id: string,
	parentId: string | undefined,
	position: number,
	createdAt: number,
): DocNode {
	return {
		id,
		parentId,
		position,
		createdAt,
		updatedAt: createdAt,
		title: id,
		kind: "document",
	} satisfies DocNode
}

describe("buildDocumentTree", () => {
	it("returns empty array for empty input", () => {
		expect(buildDocumentTree([])).toEqual([])
	})

	it("builds a flat root list when no parents", () => {
		const tree = buildDocumentTree([
			makeNode("b", undefined, 1, 0),
			makeNode("a", undefined, 0, 0),
		])
		expect(tree.map((branch) => branch.node.id)).toEqual(["b", "a"])
		expect(tree.every((branch) => branch.children.length === 0)).toBe(true)
	})

	it("nests children under their parent", () => {
		const tree = buildDocumentTree([
			makeNode("root", undefined, 0, 0),
			makeNode("c1", "root", 1, 0),
			makeNode("c0", "root", 0, 0),
		])
		expect(tree).toHaveLength(1)
		const root = tree[0]
		if (root === undefined) throw new Error("expected root branch")
		expect(root.children.map((branch) => branch.node.id)).toEqual(["c1", "c0"])
	})

	it("sorts by position desc then createdAt desc", () => {
		const tree = buildDocumentTree([
			makeNode("a", undefined, 0, 100),
			makeNode("b", undefined, 0, 50),
			makeNode("c", undefined, 1, 0),
		])
		expect(tree.map((branch) => branch.node.id)).toEqual(["c", "a", "b"])
	})

	it("packs deep hierarchies recursively", () => {
		const tree = buildDocumentTree([
			makeNode("root", undefined, 0, 0),
			makeNode("mid", "root", 0, 0),
			makeNode("leaf", "mid", 0, 0),
		])
		const root = tree[0]
		const mid = root?.children[0]
		const leaf = mid?.children[0]
		expect(leaf?.node.id).toBe("leaf")
	})

	it("does not mutate the input array", () => {
		const flat = [
			makeNode("b", undefined, 1, 0),
			makeNode("a", undefined, 0, 0),
		] as const
		const before = flat.map((n) => n.id)
		buildDocumentTree(flat)
		expect(flat.map((n) => n.id)).toEqual(before)
	})
})
