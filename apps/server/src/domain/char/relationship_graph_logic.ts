import type {
	Charactership,
	HierarchyFrom,
	RelationshipKind,
	RelationshipType,
} from "@hoardodile/schemas"
import { err, ok, type Result } from "@hoardodile/sdk-types"
import { keyBy } from "es-toolkit"

export type StoredEdge = Charactership

export type ValidateEdgeResult = Result<
	{
		readonly normalized: {
			readonly selfId: string | null
			readonly targetId: string | null
		}
	},
	{ readonly code: string; readonly message: string }
>

function ancestorId(
	type: RelationshipType,
	edge: StoredEdge,
): string | undefined {
	if (
		type.kind !== "hierarchical" ||
		type.hierarchyFrom === null ||
		edge.selfId === null ||
		edge.targetId === null
	) {
		return undefined
	}
	return type.hierarchyFrom === "self" ? edge.selfId : edge.targetId
}

function descendantId(
	type: RelationshipType,
	edge: StoredEdge,
): string | undefined {
	if (
		type.kind !== "hierarchical" ||
		type.hierarchyFrom === null ||
		edge.selfId === null ||
		edge.targetId === null
	) {
		return undefined
	}
	return type.hierarchyFrom === "self" ? edge.targetId : edge.selfId
}

/**
 * Determine whether two edges represent the exact same endpoint pair for the
 * same relationship type. Symmetric endpoints are normalized before comparison.
 * Used to reject creating a charactership that already exists.
 */
function edgesAreDuplicate(
	type: RelationshipType,
	existing: StoredEdge,
	proposed: {
		readonly selfId: string | null
		readonly targetId: string | null
		readonly externalName: string
	},
): boolean {
	if (existing.typeId !== type.id) return false
	if (existing.externalName.trim() !== proposed.externalName.trim())
		return false

	// External edges: match the exact storage side.
	if (proposed.externalName.trim().length > 0) {
		return (
			existing.selfId === proposed.selfId &&
			existing.targetId === proposed.targetId
		)
	}

	// Character-character edges: normalize symmetric endpoints, then compare.
	if (
		existing.selfId === null ||
		existing.targetId === null ||
		proposed.selfId === null ||
		proposed.targetId === null
	) {
		return false
	}
	const a = normalizeSymmetricEndpoints(
		type,
		existing.selfId,
		existing.targetId,
	)
	const b = normalizeSymmetricEndpoints(
		type,
		proposed.selfId,
		proposed.targetId,
	)
	return a.selfId === b.selfId && a.targetId === b.targetId
}

/**
 * Normalize symmetric edge endpoints to lexicographic order so A-B and B-A
 * collapse to one stored row. Only applies to character-character edges.
 */
export function normalizeSymmetricEndpoints(
	type: RelationshipType,
	selfId: string,
	targetId: string,
): { readonly selfId: string; readonly targetId: string } {
	if (type.kind !== "symmetric") {
		return { selfId, targetId }
	}
	return selfId < targetId
		? { selfId, targetId }
		: { selfId: targetId, targetId: selfId }
}

function hierarchicalWouldCycle(
	typesById: Record<string, RelationshipType>,
	edges: readonly StoredEdge[],
	type: RelationshipType,
	selfId: string,
	targetId: string,
): boolean {
	if (type.kind !== "hierarchical" || type.hierarchyFrom === null) {
		return false
	}
	const proposedAncestor = type.hierarchyFrom === "self" ? selfId : targetId
	const proposedDescendant = type.hierarchyFrom === "self" ? targetId : selfId
	if (proposedAncestor === proposedDescendant) return true

	const hierarchicalEdges = edges.filter((edge) => {
		const edgeType = typesById[edge.typeId]
		return (
			edge.selfId !== null &&
			edge.targetId !== null &&
			edgeType !== undefined &&
			edgeType.kind === "hierarchical" &&
			edgeType.hierarchyFrom !== null
		)
	})

	function descendantsOf(nodeId: string, visited: Set<string>): Set<string> {
		if (visited.has(nodeId)) return visited
		visited.add(nodeId)
		for (const edge of hierarchicalEdges) {
			const edgeType = typesById[edge.typeId]!
			const ancestor = ancestorId(edgeType, edge)
			const descendant = descendantId(edgeType, edge)
			if (
				ancestor !== undefined &&
				descendant !== undefined &&
				ancestor === nodeId
			) {
				descendantsOf(descendant, visited)
			}
		}
		return visited
	}

	const existingDescendants = descendantsOf(proposedAncestor, new Set())
	if (existingDescendants.has(proposedDescendant)) return true

	const reverseDescendants = descendantsOf(proposedDescendant, new Set())
	return reverseDescendants.has(proposedAncestor)
}

/**
 * Validate a proposed edge against relationship semantics before persistence.
 */
export function validateEdgeSemantics(
	types: readonly RelationshipType[],
	edges: readonly StoredEdge[],
	input: {
		readonly typeId: string
		readonly selfId?: string
		readonly targetId?: string
		readonly externalName?: string
	},
): ValidateEdgeResult {
	const externalName = input.externalName?.trim() ?? ""
	const hasExternal = externalName.length > 0
	const hasSelf = input.selfId !== undefined
	const hasTarget = input.targetId !== undefined

	if (hasExternal) {
		if (hasSelf && hasTarget) {
			return err({
				code: "charactership.invalid_target",
				message: "provide only one character id with externalName",
			})
		}
		if (!hasSelf && !hasTarget) {
			return err({
				code: "charactership.invalid_target",
				message: "externalName requires a character id on the other side",
			})
		}
	} else {
		if (!hasSelf || !hasTarget) {
			return err({
				code: "charactership.invalid_target",
				message: "both selfId and targetId are required without externalName",
			})
		}
		if (input.selfId === input.targetId) {
			return err({
				code: "charactership.self_link",
				message: "a character cannot be linked to itself",
			})
		}
	}

	const type = types.find((item) => item.id === input.typeId)
	if (type === undefined) {
		return err({
			code: "relationship_type.not_found",
			message: `relationship type ${input.typeId} not found`,
		})
	}

	if (hasExternal) {
		const duplicate = edges.find((edge) =>
			edgesAreDuplicate(type, edge, {
				selfId: input.selfId ?? null,
				targetId: input.targetId ?? null,
				externalName,
			}),
		)
		if (duplicate !== undefined) {
			return err({
				code: "charactership.duplicate",
				message: "an identical relationship already exists",
			})
		}
		return ok({
			normalized: {
				selfId: input.selfId ?? null,
				targetId: input.targetId ?? null,
			},
		})
	}

	const normalized = normalizeSymmetricEndpoints(
		type,
		input.selfId!,
		input.targetId!,
	)
	if (type.kind === "hierarchical" && type.hierarchyFrom === null) {
		return err({
			code: "relationship_type.hierarchy_from_required",
			message: "hierarchical relationship types require hierarchyFrom",
		})
	}
	if (
		hierarchicalWouldCycle(
			keyBy(types, (item) => item.id),
			edges,
			type,
			normalized.selfId,
			normalized.targetId,
		)
	) {
		return err({
			code: "charactership.hierarchy_cycle",
			message: "this edge would create a cycle in the hierarchy",
		})
	}

	const proposedExternalName = input.externalName?.trim() ?? ""
	const duplicate = edges.find((edge) =>
		edgesAreDuplicate(type, edge, {
			selfId: normalized.selfId,
			targetId: normalized.targetId,
			externalName: proposedExternalName,
		}),
	)
	if (duplicate !== undefined) {
		return err({
			code: "charactership.duplicate",
			message: "an identical relationship already exists",
		})
	}

	return ok({ normalized })
}

export function resolveHierarchyFrom(
	kind: RelationshipKind,
	hierarchyFromValue: HierarchyFrom | null | undefined,
): HierarchyFrom | null {
	if (kind !== "hierarchical") return null
	return hierarchyFromValue ?? "self"
}
