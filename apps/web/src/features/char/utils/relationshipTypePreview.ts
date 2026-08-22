import type { RelationshipTypeFormDraft } from "../components/RelationshipTypeFormFields"

export type PreviewDiagramOrientation = "horizontal" | "vertical"

export type PreviewDiagramLayout = {
	readonly orientation: PreviewDiagramOrientation
	/** Horizontal: self on the left. Vertical: self on top. */
	readonly selfFirst: boolean
	readonly bidirectional: boolean
}

export type PreviewCharacterCard = {
	readonly role: "self" | "target"
	readonly characterLabel: string
	readonly relationshipLabel: string
}

/** Semantic layout for the two-character relationship preview diagram. */
export function resolvePreviewDiagramLayout(
	draft: RelationshipTypeFormDraft,
): PreviewDiagramLayout {
	if (draft.kind === "hierarchical") {
		return {
			orientation: "vertical",
			selfFirst: true,
			bidirectional: false,
		}
	}
	return {
		orientation: "horizontal",
		selfFirst: true,
		bidirectional: draft.kind === "symmetric",
	}
}

export function buildPreviewDiagramCards(
	draft: RelationshipTypeFormDraft,
	labels: {
		readonly characterA: string
		readonly characterB: string
	},
): readonly [PreviewCharacterCard, PreviewCharacterCard] {
	return [
		{
			role: "self",
			characterLabel: labels.characterA,
			relationshipLabel: draft.selfLabel,
		},
		{
			role: "target",
			characterLabel: labels.characterB,
			relationshipLabel: draft.targetLabel,
		},
	]
}
