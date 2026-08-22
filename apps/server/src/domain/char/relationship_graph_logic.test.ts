import type { Charactership, RelationshipType } from "@hoardodile/schemas"
import { describe, expect, test } from "vitest"
import {
	normalizeSymmetricEndpoints,
	resolveHierarchyFrom,
	validateEdgeSemantics,
} from "./relationship_graph_logic.ts"

function makeType(
	overrides: Partial<RelationshipType> & Pick<RelationshipType, "id" | "name">,
): RelationshipType {
	return {
		selfLabel: "",
		targetLabel: "",
		kind: "directed",
		hierarchyFrom: null,
		position: 0,
		intro: "",
		color: "",
		pinned: false,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	}
}

function makeEdge(
	overrides: Partial<Charactership> &
		Pick<Charactership, "id" | "typeId" | "selfId" | "targetId">,
): Charactership {
	return {
		notes: "",
		metadata: {},
		createdAt: 1,
		externalName: "",
		...overrides,
	}
}

describe("normalizeSymmetricEndpoints", () => {
	test("orders symmetric endpoints lexicographically", () => {
		const type = makeType({ id: "t1", name: "Friend", kind: "symmetric" })
		expect(normalizeSymmetricEndpoints(type, "bob", "alice")).toEqual({
			selfId: "alice",
			targetId: "bob",
		})
	})
})

describe("validateEdgeSemantics", () => {
	const parentType = makeType({
		id: "parent",
		name: "Mentor",
		kind: "hierarchical",
		hierarchyFrom: "self",
	})

	test("rejects self links", () => {
		const result = validateEdgeSemantics([parentType], [], {
			typeId: "parent",
			selfId: "a",
			targetId: "a",
		})
		expect(result.ok).toBe(false)
	})

	test("rejects duplicate symmetric edges", () => {
		const friend = makeType({ id: "f", name: "Friend", kind: "symmetric" })
		const edges = [
			makeEdge({ id: "e1", typeId: "f", selfId: "a", targetId: "b" }),
		]
		const result = validateEdgeSemantics([friend], edges, {
			typeId: "f",
			selfId: "b",
			targetId: "a",
		})
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.code).toBe("charactership.duplicate")
		}
	})

	test("rejects hierarchy cycles", () => {
		const edges = [
			makeEdge({ id: "e1", typeId: "parent", selfId: "a", targetId: "b" }),
		]
		const result = validateEdgeSemantics([parentType], edges, {
			typeId: "parent",
			selfId: "b",
			targetId: "a",
		})
		expect(result.ok).toBe(false)
	})

	test("accepts symmetric external targets", () => {
		const friend = makeType({ id: "f", name: "Friend", kind: "symmetric" })
		const result = validateEdgeSemantics([friend], [], {
			typeId: "f",
			selfId: "anchor",
			externalName: "Tokyo",
		})
		expect(result).toEqual({
			ok: true,
			normalized: { selfId: "anchor", targetId: null },
		})
	})

	test("accepts external targets on either side", () => {
		const result = validateEdgeSemantics([parentType], [], {
			typeId: "parent",
			targetId: "anchor",
			externalName: "Org",
		})
		expect(result).toEqual({
			ok: true,
			normalized: { selfId: null, targetId: "anchor" },
		})
	})

	test("rejects duplicate external edges", () => {
		const directed = makeType({ id: "d", name: "Crush", kind: "directed" })
		const edges = [
			makeEdge({
				id: "e1",
				typeId: "d",
				selfId: "anchor",
				targetId: null,
				externalName: "City",
			}),
		]
		const result = validateEdgeSemantics([directed], edges, {
			typeId: "d",
			selfId: "anchor",
			externalName: "City",
		})
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.code).toBe("charactership.duplicate")
		}
	})

	test("rejects both targetId and externalName", () => {
		const directed = makeType({ id: "d", name: "Crush", kind: "directed" })
		const result = validateEdgeSemantics([directed], [], {
			typeId: "d",
			selfId: "a",
			targetId: "b",
			externalName: "City",
		})
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.code).toBe("charactership.invalid_target")
		}
	})

	test("rejects when neither targetId nor externalName is provided", () => {
		const directed = makeType({ id: "d", name: "Crush", kind: "directed" })
		const result = validateEdgeSemantics([directed], [], {
			typeId: "d",
			selfId: "a",
		})
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.code).toBe("charactership.invalid_target")
		}
	})

	test("rejects missing relationship type", () => {
		const result = validateEdgeSemantics([], [], {
			typeId: "missing",
			selfId: "a",
			targetId: "b",
		})
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.code).toBe("relationship_type.not_found")
		}
	})

	test("rejects duplicate directed edges in the same direction", () => {
		const directed = makeType({ id: "d", name: "Crush", kind: "directed" })
		const edges = [
			makeEdge({ id: "e1", typeId: "d", selfId: "a", targetId: "b" }),
		]
		const result = validateEdgeSemantics([directed], edges, {
			typeId: "d",
			selfId: "a",
			targetId: "b",
		})
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.code).toBe("charactership.duplicate")
		}
	})

	test("allows same pair with different relationship type", () => {
		const friend = makeType({ id: "f", name: "Friend" })
		const crush = makeType({ id: "c", name: "Crush" })
		const edges = [
			makeEdge({ id: "e1", typeId: "f", selfId: "a", targetId: "b" }),
		]
		const result = validateEdgeSemantics([friend, crush], edges, {
			typeId: "c",
			selfId: "a",
			targetId: "b",
		})
		expect(result.ok).toBe(true)
	})

	test("accepts reverse directed edges between the same pair", () => {
		const directed = makeType({ id: "d", name: "Crush", kind: "directed" })
		const edges = [
			makeEdge({ id: "e1", typeId: "d", selfId: "a", targetId: "b" }),
		]
		const result = validateEdgeSemantics([directed], edges, {
			typeId: "d",
			selfId: "b",
			targetId: "a",
		})
		expect(result.ok).toBe(true)
	})

	test("rejects hierarchy cycle when hierarchyFrom is target", () => {
		const childType = makeType({
			id: "child",
			name: "Child",
			kind: "hierarchical",
			hierarchyFrom: "target",
		})
		const edges = [
			makeEdge({ id: "e1", typeId: "child", selfId: "a", targetId: "b" }),
		]
		const result = validateEdgeSemantics([childType], edges, {
			typeId: "child",
			selfId: "b",
			targetId: "a",
		})
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.code).toBe("charactership.hierarchy_cycle")
		}
	})
})

describe("resolveHierarchyFrom", () => {
	test("returns null for non-hierarchical kinds", () => {
		expect(resolveHierarchyFrom("directed", "self")).toBeNull()
		expect(resolveHierarchyFrom("symmetric", "target")).toBeNull()
	})

	test("defaults to self when hierarchical and value is undefined", () => {
		expect(resolveHierarchyFrom("hierarchical", undefined)).toBe("self")
	})

	test("preserves target when hierarchical", () => {
		expect(resolveHierarchyFrom("hierarchical", "target")).toBe("target")
	})
})
