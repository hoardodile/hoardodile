/**
 * @vitest-environment node
 */

import type { Charactership, RelationshipType } from "@hoardodile/schemas"
import { describe, expect, it } from "vitest"
import { buildRelationshipGroups } from "./buildRelationshipGroups"

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
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}
}

const types: readonly RelationshipType[] = [
	makeType({
		id: "t1",
		name: "Parent",
		selfLabel: "Father",
		targetLabel: "Son",
	}),
	makeType({
		id: "t2",
		name: "Friend",
	}),
]

function edge(
	id: string,
	typeId: string,
	selfId: string,
	targetId: string,
): Charactership {
	return {
		id,
		typeId,
		selfId,
		targetId,
		externalName: "",
		notes: "",
		metadata: {},
		createdAt: 0,
	}
}

describe("buildRelationshipGroups", () => {
	it("returns no groups for an empty edge list", () => {
		expect(buildRelationshipGroups([], types, "anchor")).toEqual([])
	})

	it("buckets edges by (typeId, side) and uses the target label when anchor is selfId", () => {
		const groups = buildRelationshipGroups(
			[edge("e1", "t1", "anchor", "child")],
			types,
			"anchor",
		)
		expect(groups).toEqual([
			{
				key: "t1|self",
				label: "Son",
				color: "",
				otherIds: ["child"],
				otherNames: [],
			},
		])
	})

	it("uses the self label when the anchor is on the target side", () => {
		const groups = buildRelationshipGroups(
			[edge("e1", "t1", "parent", "anchor")],
			types,
			"anchor",
		)
		expect(groups).toEqual([
			{
				key: "t1|target",
				label: "Father",
				color: "",
				otherIds: ["parent"],
				otherNames: [],
			},
		])
	})

	it("groups multiple edges sharing the same (type, side)", () => {
		const groups = buildRelationshipGroups(
			[
				edge("e1", "t1", "anchor", "a"),
				edge("e2", "t1", "anchor", "b"),
				edge("e3", "t2", "anchor", "c"),
			],
			types,
			"anchor",
		)
		expect(groups).toHaveLength(2)
		const parentGroup = groups.find((g) => g.key === "t1|self")
		expect(parentGroup?.otherIds).toEqual(["a", "b"])
	})

	it("carries relationship type color on each group", () => {
		const coloredTypes: readonly RelationshipType[] = [
			makeType({
				id: "t1",
				name: "Parent",
				selfLabel: "Father",
				color: "#aabbcc",
			}),
		]
		const groups = buildRelationshipGroups(
			[edge("e1", "t1", "anchor", "child")],
			coloredTypes,
			"anchor",
		)
		expect(groups[0]?.color).toBe("#aabbcc")
	})

	it("falls back to type.name and finally typeId when labels are blank", () => {
		const groups = buildRelationshipGroups(
			[edge("e1", "t2", "anchor", "x"), edge("e2", "t-missing", "anchor", "y")],
			types,
			"anchor",
		)
		const friend = groups.find((g) => g.key === "t2|self")
		const missing = groups.find((g) => g.key === "t-missing|self")
		expect(friend?.label).toBe("Friend")
		expect(missing?.label).toBe("t-missing")
	})

	it("skips external edges where anchor is not involved", () => {
		const groups = buildRelationshipGroups(
			[
				{
					id: "e1",
					typeId: "t1",
					selfId: "other",
					targetId: null,
					externalName: "Tokyo",
					notes: "",
					metadata: {},
					createdAt: 0,
				},
			],
			types,
			"anchor",
		)
		expect(groups).toEqual([])
	})

	it("groups external name targets under the self side", () => {
		const groups = buildRelationshipGroups(
			[
				{
					id: "e1",
					typeId: "t1",
					selfId: "anchor",
					targetId: null,
					externalName: "Tokyo",
					notes: "",
					metadata: {},
					createdAt: 0,
				},
			],
			types,
			"anchor",
		)
		expect(groups).toEqual([
			{
				key: "t1|self|external",
				label: "Son",
				color: "",
				otherIds: [],
				otherNames: ["Tokyo"],
			},
		])
	})

	it("groups external name sources under the target side", () => {
		const groups = buildRelationshipGroups(
			[
				{
					id: "e1",
					typeId: "t1",
					selfId: null,
					targetId: "anchor",
					externalName: "Tokyo",
					notes: "",
					metadata: {},
					createdAt: 0,
				},
			],
			types,
			"anchor",
		)
		expect(groups).toEqual([
			{
				key: "t1|target|external",
				label: "Father",
				color: "",
				otherIds: [],
				otherNames: ["Tokyo"],
			},
		])
	})
})
