import type { Charactership, RelationshipType } from "@hoardodile/schemas"

export type CharactershipSideLabels = {
	readonly leftLabel: string
	readonly rightLabel: string
}

function fallbackLabel(
	type: RelationshipType | undefined,
	field: "selfLabel" | "targetLabel" | "name",
	typeId: string,
): string {
	if (type === undefined) return typeId
	const value = type[field]
	if (field !== "name" && value.trim().length > 0) return value
	if (type.name.trim().length > 0) return type.name
	return typeId
}

/**
 * Resolve the labels shown under the left and right endpoints of a
 * charactership row. Semantics match relationship type preview:
 * selfLabel = self is target's …; targetLabel = target is self's …
 */
export function resolveCharactershipSideLabels(
	edge: Charactership,
	type: RelationshipType | undefined,
	anchorCharId: string,
): CharactershipSideLabels {
	const selfLabel = fallbackLabel(type, "selfLabel", edge.typeId)
	const targetLabel = fallbackLabel(type, "targetLabel", edge.typeId)
	const anchorOnLeft = anchorIsOnLeft(edge, anchorCharId)
	const selfOnLeft = edge.selfId === anchorCharId ? anchorOnLeft : !anchorOnLeft
	return {
		leftLabel: selfOnLeft ? selfLabel : targetLabel,
		rightLabel: selfOnLeft ? targetLabel : selfLabel,
	}
}

export function isExternalCharactership(edge: Charactership): boolean {
	return (
		(edge.selfId === null || edge.targetId === null) &&
		edge.externalName.length > 0
	)
}

export function anchorIsOnLeft(
	edge: Charactership,
	anchorCharId: string,
): boolean {
	return edge.selfId === anchorCharId
}

export function otherCharacterId(
	edge: Charactership,
	anchorCharId: string,
): string | undefined {
	if (isExternalCharactership(edge)) return undefined
	return edge.selfId === anchorCharId
		? (edge.targetId ?? undefined)
		: (edge.selfId ?? undefined)
}

export type DraftAnchorSide = "left" | "right"

export type DraftOtherTarget =
	| { readonly kind: "character"; readonly id: string }
	| { readonly kind: "external"; readonly name: string }

/** Labels for a draft row before or after the user picks a side. */
export function resolveDraftSideLabels(
	type: RelationshipType | undefined,
	_anchorSide: DraftAnchorSide | null,
	typeId: string,
): CharactershipSideLabels {
	const selfLabel = fallbackLabel(type, "selfLabel", typeId)
	const targetLabel = fallbackLabel(type, "targetLabel", typeId)
	return { leftLabel: selfLabel, rightLabel: targetLabel }
}

export type CharactershipDraftInput = {
	readonly typeId: string
	readonly anchorSide: DraftAnchorSide | null
	readonly otherSide: DraftAnchorSide | null
	readonly otherTarget: DraftOtherTarget | null
}

export function buildCreateCharactershipInput(
	charId: string,
	draft: CharactershipDraftInput,
):
	| {
			readonly typeId: string
			readonly selfId: string
			readonly targetId: string
	  }
	| {
			readonly typeId: string
			readonly selfId?: string
			readonly targetId?: string
			readonly externalName: string
	  }
	| undefined {
	if (draft.otherTarget === null || draft.anchorSide === null) {
		return undefined
	}
	if (draft.otherTarget.kind === "external") {
		const name = draft.otherTarget.name.trim()
		if (name.length === 0) return undefined
		if (draft.anchorSide === "left") {
			return {
				typeId: draft.typeId,
				selfId: charId,
				externalName: name,
			}
		}
		return {
			typeId: draft.typeId,
			targetId: charId,
			externalName: name,
		}
	}
	if (draft.anchorSide === "left") {
		return {
			typeId: draft.typeId,
			selfId: charId,
			targetId: draft.otherTarget.id,
		}
	}
	return {
		typeId: draft.typeId,
		selfId: draft.otherTarget.id,
		targetId: charId,
	}
}

export function isCharactershipDraftComplete(
	draft: CharactershipDraftInput,
): boolean {
	return buildCreateCharactershipInput("", draft) !== undefined
}
