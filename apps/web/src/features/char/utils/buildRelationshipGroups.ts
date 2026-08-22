import type { Charactership, RelationshipType } from "@hoardodile/schemas"
import { keyBy } from "es-toolkit"

export type RelationshipGroup = {
	readonly key: string
	readonly label: string
	readonly color: string
	readonly otherIds: readonly string[]
	readonly otherNames: readonly string[]
}

function isExternalEdge(edge: Charactership): boolean {
	return (
		(edge.selfId === null || edge.targetId === null) &&
		edge.externalName.length > 0
	)
}

/**
 * Bucket a character's relationship edges into one group per
 * `(typeId, side)` pair. The displayed label uses the opposite endpoint's
 * role: when the anchor is `selfId`, show `targetLabel`; when on `targetId`,
 * show `selfLabel`.
 *
 * The label falls back to `type.name` and finally `edge.typeId` so the
 * group always has a non-empty caption even if a relationship type is
 * concurrently being deleted.
 */
export function buildRelationshipGroups(
	edges: readonly Charactership[],
	types: readonly RelationshipType[],
	anchorCharacterId: string,
): readonly RelationshipGroup[] {
	const typeById = keyBy(types, (type) => type.id)
	const buckets = new Map<
		string,
		{ label: string; color: string; otherIds: string[]; otherNames: string[] }
	>()
	for (const edge of edges) {
		const type = typeById[edge.typeId]
		const isSelfSide = edge.selfId === anchorCharacterId
		const isTargetSide = edge.targetId === anchorCharacterId
		if (isExternalEdge(edge)) {
			if (!isSelfSide && !isTargetSide) continue
			const label = isSelfSide
				? type?.targetLabel || type?.name || edge.typeId
				: type?.selfLabel || type?.name || edge.typeId
			const color = type?.color ?? ""
			const side = isSelfSide ? "self" : "target"
			const key = `${edge.typeId}|${side}|external`
			const bucket = buckets.get(key)
			if (bucket !== undefined) {
				bucket.otherNames.push(edge.externalName)
			} else {
				buckets.set(key, {
					label,
					color,
					otherIds: [],
					otherNames: [edge.externalName],
				})
			}
			continue
		}
		const otherId = isSelfSide ? edge.targetId : edge.selfId
		if (otherId === null) continue
		const label = isSelfSide
			? type?.targetLabel || type?.name || edge.typeId
			: type?.selfLabel || type?.name || edge.typeId
		const color = type?.color ?? ""
		const key = `${edge.typeId}|${isSelfSide ? "self" : "target"}`
		const bucket = buckets.get(key)
		if (bucket !== undefined) bucket.otherIds.push(otherId)
		else
			buckets.set(key, {
				label,
				color,
				otherIds: [otherId],
				otherNames: [],
			})
	}
	return [...buckets.entries()].map(([key, bucket]) => ({
		key,
		label: bucket.label,
		color: bucket.color,
		otherIds: bucket.otherIds,
		otherNames: bucket.otherNames,
	}))
}
