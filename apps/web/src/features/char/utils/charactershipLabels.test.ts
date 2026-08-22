/**
 * @vitest-environment node
 */

import type { Charactership, RelationshipType } from "@hoardodile/schemas"
import { describe, expect, it } from "vitest"
import {
	anchorIsOnLeft,
	buildCreateCharactershipInput,
	isCharactershipDraftComplete,
	isExternalCharactership,
	otherCharacterId,
	resolveCharactershipSideLabels,
	resolveDraftSideLabels,
} from "./charactershipLabels"

function makeType(
	overrides: Partial<RelationshipType> & Pick<RelationshipType, "id">,
): RelationshipType {
	return {
		name: "Type",
		selfLabel: "Self",
		targetLabel: "Target",
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

function edge(
	overrides: Partial<Charactership> & Pick<Charactership, "id" | "typeId">,
): Charactership {
	return {
		selfId: "a",
		targetId: "b",
		externalName: "",
		notes: "",
		metadata: {},
		createdAt: 0,
		...overrides,
	}
}

describe("resolveCharactershipSideLabels", () => {
	it("maps self/target labels when anchor is selfId", () => {
		const labels = resolveCharactershipSideLabels(
			edge({ id: "e1", typeId: "t1", selfId: "anchor", targetId: "other" }),
			makeType({
				id: "t1",
				selfLabel: "Master",
				targetLabel: "Apprentice",
			}),
			"anchor",
		)
		expect(labels).toEqual({ leftLabel: "Master", rightLabel: "Apprentice" })
	})

	it("keeps self label on the left when anchor is targetId", () => {
		const labels = resolveCharactershipSideLabels(
			edge({ id: "e1", typeId: "t1", selfId: "other", targetId: "anchor" }),
			makeType({
				id: "t1",
				selfLabel: "Master",
				targetLabel: "Apprentice",
			}),
			"anchor",
		)
		expect(labels).toEqual({ leftLabel: "Master", rightLabel: "Apprentice" })
	})

	it("labels external edges based on which side the anchor is on", () => {
		expect(
			resolveCharactershipSideLabels(
				edge({
					id: "e1",
					typeId: "t1",
					selfId: "anchor",
					targetId: null,
					externalName: "City",
				}),
				makeType({
					id: "t1",
					selfLabel: "Crush",
					targetLabel: "Admired",
				}),
				"anchor",
			),
		).toEqual({ leftLabel: "Crush", rightLabel: "Admired" })
		expect(
			resolveCharactershipSideLabels(
				edge({
					id: "e2",
					typeId: "t1",
					selfId: null,
					targetId: "anchor",
					externalName: "City",
				}),
				makeType({
					id: "t1",
					selfLabel: "Crush",
					targetLabel: "Admired",
				}),
				"anchor",
			),
		).toEqual({ leftLabel: "Crush", rightLabel: "Admired" })
		expect(isExternalCharactership(edge({ id: "x", typeId: "t1" }))).toBe(false)
		expect(
			isExternalCharactership(
				edge({
					id: "x",
					typeId: "t1",
					targetId: null,
					externalName: "City",
				}),
			),
		).toBe(true)
		expect(
			isExternalCharactership(
				edge({
					id: "x",
					typeId: "t1",
					selfId: null,
					externalName: "City",
				}),
			),
		).toBe(true)
	})
})

describe("anchorIsOnLeft", () => {
	it("returns whether anchor matches selfId, including external edges", () => {
		expect(
			anchorIsOnLeft(
				edge({
					id: "e1",
					typeId: "t1",
					selfId: "anchor",
					targetId: null,
					externalName: "X",
				}),
				"anchor",
			),
		).toBe(true)
		expect(
			anchorIsOnLeft(
				edge({
					id: "e2",
					typeId: "t1",
					selfId: null,
					targetId: "anchor",
					externalName: "X",
				}),
				"anchor",
			),
		).toBe(false)
	})

	it("returns whether anchor matches selfId for character edges", () => {
		expect(
			anchorIsOnLeft(
				edge({ id: "e1", typeId: "t1", selfId: "anchor", targetId: "b" }),
				"anchor",
			),
		).toBe(true)
		expect(
			anchorIsOnLeft(
				edge({ id: "e1", typeId: "t1", selfId: "a", targetId: "anchor" }),
				"anchor",
			),
		).toBe(false)
	})
})

describe("resolveDraftSideLabels", () => {
	it("uses self on left and target on right when anchorSide is null", () => {
		const type = makeType({
			id: "t1",
			selfLabel: "Master",
			targetLabel: "Apprentice",
		})
		expect(resolveDraftSideLabels(type, null, "t1")).toEqual({
			leftLabel: "Master",
			rightLabel: "Apprentice",
		})
	})

	it("maps anchor on left like a saved edge with anchor as selfId", () => {
		const type = makeType({
			id: "t1",
			selfLabel: "Master",
			targetLabel: "Apprentice",
		})
		expect(resolveDraftSideLabels(type, "left", "t1")).toEqual({
			leftLabel: "Master",
			rightLabel: "Apprentice",
		})
	})

	it("keeps self label on the left regardless of anchor side", () => {
		const type = makeType({
			id: "t1",
			selfLabel: "Master",
			targetLabel: "Apprentice",
		})
		expect(resolveDraftSideLabels(type, "right", "t1")).toEqual({
			leftLabel: "Master",
			rightLabel: "Apprentice",
		})
	})
})

describe("isCharactershipDraftComplete", () => {
	it("returns false when anchor or target is missing", () => {
		expect(
			isCharactershipDraftComplete({
				typeId: "t1",
				anchorSide: null,
				otherSide: "right",
				otherTarget: { kind: "character", id: "other" },
			}),
		).toBe(false)
		expect(
			isCharactershipDraftComplete({
				typeId: "t1",
				anchorSide: "left",
				otherSide: "right",
				otherTarget: null,
			}),
		).toBe(false)
	})

	it("returns false for whitespace-only external names", () => {
		expect(
			isCharactershipDraftComplete({
				typeId: "t1",
				anchorSide: "left",
				otherSide: "right",
				otherTarget: { kind: "external", name: "   " },
			}),
		).toBe(false)
	})

	it("returns true for a complete character draft", () => {
		expect(
			isCharactershipDraftComplete({
				typeId: "t1",
				anchorSide: "left",
				otherSide: "right",
				otherTarget: { kind: "character", id: "other" },
			}),
		).toBe(true)
	})
})

describe("buildCreateCharactershipInput", () => {
	it("builds character edge with anchor on the left", () => {
		expect(
			buildCreateCharactershipInput("anchor", {
				typeId: "t1",
				anchorSide: "left",
				otherSide: "right",
				otherTarget: { kind: "character", id: "other" },
			}),
		).toEqual({
			typeId: "t1",
			selfId: "anchor",
			targetId: "other",
		})
	})

	it("builds character edge with anchor on the right", () => {
		expect(
			buildCreateCharactershipInput("anchor", {
				typeId: "t1",
				anchorSide: "right",
				otherSide: "left",
				otherTarget: { kind: "character", id: "other" },
			}),
		).toEqual({
			typeId: "t1",
			selfId: "other",
			targetId: "anchor",
		})
	})

	it("builds external name edge with anchor on the left", () => {
		expect(
			buildCreateCharactershipInput("anchor", {
				typeId: "t1",
				anchorSide: "left",
				otherSide: "right",
				otherTarget: { kind: "external", name: "Tokyo" },
			}),
		).toEqual({
			typeId: "t1",
			selfId: "anchor",
			externalName: "Tokyo",
		})
	})

	it("builds external name edge with anchor on the right", () => {
		expect(
			buildCreateCharactershipInput("anchor", {
				typeId: "t1",
				anchorSide: "right",
				otherSide: "left",
				otherTarget: { kind: "external", name: "Tokyo" },
			}),
		).toEqual({
			typeId: "t1",
			targetId: "anchor",
			externalName: "Tokyo",
		})
	})
})

describe("otherCharacterId", () => {
	it("returns the opposite character id", () => {
		expect(
			otherCharacterId(
				edge({ id: "e1", typeId: "t1", selfId: "anchor", targetId: "b" }),
				"anchor",
			),
		).toBe("b")
		expect(
			otherCharacterId(
				edge({ id: "e1", typeId: "t1", selfId: "a", targetId: "anchor" }),
				"anchor",
			),
		).toBe("a")
	})
})
