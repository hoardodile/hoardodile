/**
 * @vitest-environment node
 */

import type { RelationshipType } from "@hoardodile/schemas"
import { describe, expect, it } from "vitest"
import {
	buildCreateTypePayload,
	buildUpdateTypePayload,
	draftFromRelationshipType,
	emptyRelationshipTypeDraft,
	isRelationshipTypeDefinitionComplete,
} from "./RelationshipTypeFormFields"

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

describe("isRelationshipTypeDefinitionComplete", () => {
	it("returns false for an untouched empty draft", () => {
		expect(
			isRelationshipTypeDefinitionComplete(emptyRelationshipTypeDraft()),
		).toBe(false)
	})

	it("returns true when a direction label is filled", () => {
		const draft = { ...emptyRelationshipTypeDraft(), selfLabel: "mentor" }
		expect(isRelationshipTypeDefinitionComplete(draft)).toBe(true)
	})

	it("returns true when kind changes", () => {
		expect(
			isRelationshipTypeDefinitionComplete({
				...emptyRelationshipTypeDraft(),
				kind: "symmetric",
			}),
		).toBe(true)
		expect(
			isRelationshipTypeDefinitionComplete({
				...emptyRelationshipTypeDraft(),
				kind: "hierarchical",
			}),
		).toBe(true)
	})
})

describe("draftFromRelationshipType", () => {
	it("preserves hierarchyFrom from the stored type", () => {
		const draft = draftFromRelationshipType(
			makeType({
				id: "t1",
				name: "Mentor",
				kind: "hierarchical",
				hierarchyFrom: "target",
			}),
		)
		expect(draft.hierarchyFrom).toBe("target")
	})
})

describe("buildCreateTypePayload", () => {
	it("uses draft hierarchyFrom for hierarchical types", () => {
		const payload = buildCreateTypePayload({
			...emptyRelationshipTypeDraft(),
			name: "Mentor",
			selfLabel: "mentor",
			targetLabel: "apprentice",
			kind: "hierarchical",
			hierarchyFrom: "target",
		})
		expect(payload?.hierarchyFrom).toBe("target")
	})

	it("sets hierarchyFrom to null for non-hierarchical kinds", () => {
		const payload = buildCreateTypePayload({
			...emptyRelationshipTypeDraft(),
			name: "Friend",
			selfLabel: "friend",
			kind: "symmetric",
			hierarchyFrom: "target",
		})
		expect(payload?.hierarchyFrom).toBeNull()
	})
})

describe("buildUpdateTypePayload", () => {
	it("preserves id and hierarchyFrom when updating", () => {
		const payload = buildUpdateTypePayload("t1", {
			...emptyRelationshipTypeDraft(),
			name: "Mentor",
			selfLabel: "mentor",
			targetLabel: "apprentice",
			kind: "hierarchical",
			hierarchyFrom: "target",
		})
		expect(payload).toEqual(
			expect.objectContaining({
				id: "t1",
				hierarchyFrom: "target",
			}),
		)
	})
})
