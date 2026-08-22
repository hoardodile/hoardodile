import type {
	Charactership,
	CharactershipMetadata,
	HierarchyFrom,
	RelationshipKind,
	RelationshipType,
} from "@hoardodile/schemas"
import { charactershipMetadata as charactershipMetadataSchema } from "@hoardodile/schemas"
import { isErr } from "@hoardodile/sdk-types"
import { conflict, invalid } from "@hoardodile/shared"
import { eq, inArray } from "drizzle-orm"
import { uniq } from "es-toolkit"
import {
	type DbClient,
	type SqliteDb,
	withTransaction,
} from "src/infra/db/connection.ts"
import {
	buildForceDelete,
	buildMaxPosition,
	buildReorder,
	filterDefined,
	resolveClock,
} from "src/infra/service.ts"
import {
	resolveHierarchyFrom,
	validateEdgeSemantics,
} from "./relationship_graph_logic.ts"
import {
	buildRelationshipRepository,
	type CharactershipRow,
	type RelationshipTypeRow,
} from "./relationship_repo.ts"
import { characters } from "./schema.ts"

export type RelationshipServiceDeps = {
	readonly db: SqliteDb
	readonly now?: () => number
	readonly newId?: () => string
}

export type RelationshipService = {
	listTypes(): Promise<readonly RelationshipType[]>
	listTypesWithCounts(): Promise<readonly RelationshipTypeWithCounts[]>
	createType(input: CreateTypeInput): Promise<RelationshipType>
	updateType(input: UpdateTypeInput): Promise<RelationshipType>
	deleteType(id: string): Promise<void>
	forceDeleteType(id: string, confirmName: string): Promise<void>
	reorderTypes(ids: readonly string[]): Promise<void>

	listCharacterships(charId: string): Promise<readonly Charactership[]>
	listCharactershipsForCharacters(
		charIds: readonly string[],
	): Promise<readonly Charactership[]>
	createCharactership(input: CreateCharactershipInput): Promise<Charactership>
	updateCharactership(input: UpdateCharactershipInput): Promise<Charactership>
	deleteCharactership(id: string): Promise<void>
}

export type CreateTypeInput = {
	readonly name: string
	readonly selfLabel?: string
	readonly targetLabel?: string
	readonly kind?: RelationshipKind
	readonly hierarchyFrom?: HierarchyFrom | null
	readonly intro?: string
	readonly color?: string
	readonly pinned?: boolean
}

export type UpdateTypeInput = {
	readonly id: string
	readonly name?: string
	readonly selfLabel?: string
	readonly targetLabel?: string
	readonly kind?: RelationshipKind
	readonly hierarchyFrom?: HierarchyFrom | null
	readonly intro?: string
	readonly color?: string
	readonly pinned?: boolean
}

export type RelationshipTypeWithCounts = RelationshipType & {
	readonly edgeCount: number
}

export type CreateCharactershipInput = {
	readonly typeId: string
	readonly selfId?: string
	readonly targetId?: string
	readonly externalName?: string
	readonly notes?: string
	readonly metadata?: CharactershipMetadata
}

export type UpdateCharactershipInput = {
	readonly id: string
	readonly notes?: string
	readonly metadata?: CharactershipMetadata
}

function parseMetadataJson(raw: string): CharactershipMetadata {
	try {
		const parsed: unknown = JSON.parse(raw)
		return charactershipMetadataSchema.parse(parsed)
	} catch {
		return {}
	}
}

function rowToRelationshipType(row: RelationshipTypeRow): RelationshipType {
	return {
		id: row.id,
		name: row.name,
		selfLabel: row.selfLabel,
		targetLabel: row.targetLabel,
		kind: row.kind as RelationshipKind,
		hierarchyFrom:
			row.hierarchyFrom === null || row.hierarchyFrom === ""
				? null
				: (row.hierarchyFrom as HierarchyFrom),
		position: row.position,
		intro: row.intro,
		color: row.color,
		pinned: row.pinned,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}
}

function rowToCharactership(row: CharactershipRow): Charactership {
	return {
		id: row.id,
		typeId: row.typeId,
		selfId: row.selfId,
		targetId: row.targetId,
		externalName: row.externalName,
		notes: row.notes,
		metadata: parseMetadataJson(row.metadata),
		createdAt: row.createdAt,
	}
}

function defaultTypeValues(
	input: Pick<
		CreateTypeInput,
		| "name"
		| "selfLabel"
		| "targetLabel"
		| "kind"
		| "hierarchyFrom"
		| "intro"
		| "color"
		| "pinned"
	>,
): {
	readonly name: string
	readonly selfLabel: string
	readonly targetLabel: string
	readonly kind: string
	readonly hierarchyFrom: string | null
	readonly intro: string
	readonly color: string
	readonly pinned: boolean
} {
	const kind = input.kind ?? "directed"
	return {
		name: input.name,
		selfLabel: input.selfLabel ?? "",
		targetLabel: input.targetLabel ?? "",
		kind,
		hierarchyFrom: resolveHierarchyFrom(kind, input.hierarchyFrom ?? null),
		intro: input.intro ?? "",
		color: input.color ?? "",
		pinned: input.pinned ?? false,
	}
}

/**
 * Build a {@link RelationshipService} that manages named relationship types
 * and directed edges between characters.
 */
export function createRelationshipService(
	deps: RelationshipServiceDeps,
): RelationshipService {
	const repo = buildRelationshipRepository(deps.db)
	const { now, newId } = resolveClock(deps)

	function bumpCharacterTimestamps(
		client: DbClient,
		ids: readonly string[],
	): void {
		const unique = uniq(ids)
		if (unique.length === 0) return
		const ts = now()
		client
			.update(characters)
			.set({ updatedAt: ts })
			.where(
				unique.length === 1
					? eq(characters.id, unique[0]!)
					: inArray(characters.id, unique),
			)
			.run()
	}

	function listTypes(): readonly RelationshipType[] {
		return repo.listTypes().map(rowToRelationshipType)
	}

	function listTypesWithCounts(): readonly RelationshipTypeWithCounts[] {
		return repo.listTypes().map((row) => ({
			...rowToRelationshipType(row),
			edgeCount: repo.countCharactershipUsages(row.id),
		}))
	}

	function maxPosition(): number {
		return buildMaxPosition(repo.listTypes)()
	}

	function createType(input: CreateTypeInput): RelationshipType {
		const kind = input.kind ?? "directed"
		if (kind === "hierarchical" && input.hierarchyFrom === undefined) {
			throw invalid(
				"relationship_type.hierarchy_from_required",
				"hierarchical relationship types require hierarchyFrom",
			)
		}
		const id = newId()
		const ts = now()
		repo.insertType(
			id,
			{ ...defaultTypeValues(input), position: maxPosition() + 1 },
			ts,
		)
		return rowToRelationshipType(repo.findTypeById(id))
	}

	function updateType(input: UpdateTypeInput): RelationshipType {
		const before = rowToRelationshipType(repo.findTypeById(input.id))
		const kind = input.kind ?? before.kind
		const patch: Parameters<typeof repo.patchType>[1] = {
			...filterDefined({
				name: input.name,
				selfLabel: input.selfLabel,
				targetLabel: input.targetLabel,
				kind: input.kind,
				intro: input.intro,
				color: input.color,
				pinned: input.pinned,
			}),
			updatedAt: now(),
		}
		if (input.hierarchyFrom !== undefined) {
			patch.hierarchyFrom = resolveHierarchyFrom(kind, input.hierarchyFrom)
		} else if (input.kind === "hierarchical" && before.hierarchyFrom === null) {
			patch.hierarchyFrom = "self"
		}
		if (kind !== "hierarchical") patch.hierarchyFrom = null
		repo.patchType(input.id, patch)
		return rowToRelationshipType(repo.findTypeById(input.id))
	}

	function deleteType(id: string): void {
		repo.findTypeById(id)
		const usages = repo.countCharactershipUsages(id)
		if (usages > 0) {
			throw conflict(
				"relationship_type.has_dependencies",
				`relationship type ${id} is in use by ${usages} edge(s)`,
				{ id, edges: usages },
			)
		}
		repo.removeType(id)
	}

	function forceDeleteType(id: string, confirmName: string): void {
		buildForceDelete({
			entity: "relationship_type",
			findById: repo.findTypeById,
			remove: repo.removeType,
		})(id, confirmName)
	}

	function reorderTypes(ids: readonly string[]): void {
		buildReorder<RelationshipTypeRow>({
			entity: "relationship_type",
			listAll: repo.listTypes,
			patch: repo.patchType,
			now,
		})(ids)
	}

	function listCharacterships(charId: string): readonly Charactership[] {
		return repo.listCharactershipsForCharacter(charId).map(rowToCharactership)
	}

	function listCharactershipsForCharacters(
		charIds: readonly string[],
	): readonly Charactership[] {
		return repo.listCharactershipsForCharacters(charIds).map(rowToCharactership)
	}

	function createCharactership(input: CreateCharactershipInput): Charactership {
		const types = listTypes()
		const edges = repo.listAllCharacterships().map(rowToCharactership)
		const validation = validateEdgeSemantics(types, edges, input)
		if (isErr(validation)) {
			throw conflict(validation.code, validation.message, {
				selfId: input.selfId,
				targetId: input.targetId,
				typeId: input.typeId,
			})
		}
		const id = newId()
		const ts = now()
		const externalName = input.externalName?.trim() ?? ""
		withTransaction(deps.db, (tx) => {
			const txRepo = buildRelationshipRepository(tx)
			txRepo.insertCharactership(
				id,
				{
					typeId: input.typeId,
					selfId: validation.normalized.selfId,
					targetId: validation.normalized.targetId,
					externalName,
					notes: input.notes ?? "",
					metadata: JSON.stringify(input.metadata ?? {}),
				},
				ts,
			)
			const row = txRepo.findCharactershipById(id)
			const bumpIds = [row.selfId, row.targetId].filter(
				(charId): charId is string => charId !== null,
			)
			bumpCharacterTimestamps(tx, bumpIds)
		})
		return rowToCharactership(repo.findCharactershipById(id))
	}

	function updateCharactership(input: UpdateCharactershipInput): Charactership {
		const before = repo.findCharactershipById(input.id)
		withTransaction(deps.db, (tx) => {
			const txRepo = buildRelationshipRepository(tx)
			const patch: Parameters<typeof txRepo.patchCharactership>[1] = {}
			if (input.notes !== undefined) patch.notes = input.notes
			if (input.metadata !== undefined) {
				patch.metadata = JSON.stringify(input.metadata)
			}
			txRepo.patchCharactership(input.id, patch)
			const bumpIds = [before.selfId, before.targetId].filter(
				(charId): charId is string => charId !== null,
			)
			bumpCharacterTimestamps(tx, bumpIds)
		})
		return rowToCharactership(repo.findCharactershipById(input.id))
	}

	function deleteCharactership(id: string): void {
		const before = repo.findCharactershipById(id)
		withTransaction(deps.db, (tx) => {
			const txRepo = buildRelationshipRepository(tx)
			txRepo.removeCharactership(id)
			const bumpIds = [before.selfId, before.targetId].filter(
				(charId): charId is string => charId !== null,
			)
			bumpCharacterTimestamps(tx, bumpIds)
		})
	}

	return {
		listTypes: async () => listTypes(),
		listTypesWithCounts: async () => listTypesWithCounts(),
		createType: async (input) => createType(input),
		updateType: async (input) => updateType(input),
		deleteType: async (id) => deleteType(id),
		forceDeleteType: async (id, confirmName) =>
			forceDeleteType(id, confirmName),
		reorderTypes: async (ids) => reorderTypes(ids),
		listCharacterships: async (charId) => listCharacterships(charId),
		listCharactershipsForCharacters: async (charIds) =>
			listCharactershipsForCharacters(charIds),
		createCharactership: async (input) => createCharactership(input),
		updateCharactership: async (input) => updateCharactership(input),
		deleteCharactership: async (id) => deleteCharactership(id),
	}
}
