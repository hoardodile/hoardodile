import type { RelationshipKind } from "@hoardodile/schemas"
import { buildEntityMetaCreatePayload } from "@/lib/entityMetaDraft"

export type RelationshipTypeFormDraft = {
	readonly name: string
	readonly selfLabel: string
	readonly targetLabel: string
	readonly kind: RelationshipKind
	readonly hierarchyFrom: "self" | "target"
	readonly intro: string
	readonly color: string
	readonly pinned: boolean
}

export { RelationshipTypeVisualEditor as RelationshipTypeFormFields } from "./RelationshipTypeVisualEditor"

export function emptyRelationshipTypeDraft(): RelationshipTypeFormDraft {
	return {
		name: "",
		selfLabel: "",
		targetLabel: "",
		kind: "directed",
		hierarchyFrom: "self",
		intro: "",
		color: "",
		pinned: false,
	}
}

/** True when the user has filled or changed definition fields (not just visited the tab). */
export function isRelationshipTypeDefinitionComplete(
	draft: RelationshipTypeFormDraft,
): boolean {
	const empty = emptyRelationshipTypeDraft()
	return (
		draft.selfLabel.trim().length > 0 ||
		draft.targetLabel.trim().length > 0 ||
		draft.kind !== empty.kind
	)
}

export function draftFromRelationshipType(
	type: import("@hoardodile/schemas").RelationshipType,
): RelationshipTypeFormDraft {
	return {
		name: type.name,
		selfLabel: type.selfLabel,
		targetLabel: type.targetLabel,
		kind: type.kind,
		hierarchyFrom: type.hierarchyFrom ?? "self",
		intro: type.intro,
		color: type.color ?? "",
		pinned: type.pinned,
	}
}

export function buildCreateTypePayload(draft: RelationshipTypeFormDraft) {
	const meta = buildEntityMetaCreatePayload({
		name: draft.name,
		intro: draft.intro.trim(),
		color: draft.color.trim(),
		pinned: draft.pinned,
	})
	if (meta === undefined) return undefined
	return {
		...meta,
		selfLabel: draft.selfLabel.trim() || undefined,
		targetLabel: draft.targetLabel.trim() || undefined,
		kind: draft.kind,
		hierarchyFrom: draft.kind === "hierarchical" ? draft.hierarchyFrom : null,
	}
}

export function buildUpdateTypePayload(
	id: string,
	draft: RelationshipTypeFormDraft,
) {
	const base = buildCreateTypePayload(draft)
	if (base === undefined) return undefined
	return { id, ...base }
}
