/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import type { RelationshipTypeFormDraft } from "../components/RelationshipTypeFormFields"
import {
	buildPreviewDiagramCards,
	resolvePreviewDiagramLayout,
} from "./relationshipTypePreview"

const PREVIEW_LABELS = {
	characterA: "Character A",
	characterB: "Character B",
}

function baseDraft(
	patch: Partial<RelationshipTypeFormDraft> = {},
): RelationshipTypeFormDraft {
	return {
		name: "Friend",
		selfLabel: "friend",
		targetLabel: "friend",
		kind: "directed",
		hierarchyFrom: "self",
		intro: "",
		color: "",
		pinned: false,
		...patch,
	}
}

describe("resolvePreviewDiagramLayout", () => {
	it("lays directed relationships horizontally with self first", () => {
		const layout = resolvePreviewDiagramLayout(baseDraft({ kind: "directed" }))
		expect(layout).toEqual({
			orientation: "horizontal",
			selfFirst: true,
			bidirectional: false,
		})
	})

	it("uses bidirectional arrows for symmetric relationships", () => {
		const layout = resolvePreviewDiagramLayout(baseDraft({ kind: "symmetric" }))
		expect(layout).toEqual({
			orientation: "horizontal",
			selfFirst: true,
			bidirectional: true,
		})
	})

	it("lays hierarchical relationships vertically with A above B", () => {
		const layout = resolvePreviewDiagramLayout(
			baseDraft({ kind: "hierarchical" }),
		)
		expect(layout).toEqual({
			orientation: "vertical",
			selfFirst: true,
			bidirectional: false,
		})
	})
})

describe("buildPreviewDiagramCards", () => {
	it("binds self and target labels to the matching cards", () => {
		const [selfCard, targetCard] = buildPreviewDiagramCards(
			baseDraft({ selfLabel: "parent", targetLabel: "child" }),
			PREVIEW_LABELS,
		)
		expect(selfCard.relationshipLabel).toBe("parent")
		expect(targetCard.relationshipLabel).toBe("child")
		expect(selfCard.characterLabel).toBe("Character A")
		expect(targetCard.characterLabel).toBe("Character B")
	})
})
