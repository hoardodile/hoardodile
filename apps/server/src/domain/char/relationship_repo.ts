import { notFound } from "@hoardodile/shared"
import { asc, count, eq, inArray, or } from "drizzle-orm"
import type { DbClient } from "src/infra/db/connection.ts"
import { characterships, relationshipTypes } from "./schema.ts"

export type RelationshipTypeRow = typeof relationshipTypes.$inferSelect
export type CharactershipRow = typeof characterships.$inferSelect

/**
 * Pure Drizzle query layer for the relationship module. No domain business
 * rules — those live in {@link buildRelationshipService}.
 */
export type RelationshipRepository = {
	findTypeById(id: string): RelationshipTypeRow
	listTypes(): readonly RelationshipTypeRow[]
	insertType(id: string, values: RelationshipTypeValues, ts: number): void
	patchType(id: string, fields: RelationshipTypePatch): void
	removeType(id: string): void
	countCharactershipUsages(typeId: string): number

	findCharactershipById(id: string): CharactershipRow
	listCharactershipsForCharacter(charId: string): readonly CharactershipRow[]
	listCharactershipsForCharacters(
		charIds: readonly string[],
	): readonly CharactershipRow[]
	listAllCharacterships(): readonly CharactershipRow[]
	insertCharactership(id: string, values: CharactershipValues, ts: number): void
	patchCharactership(id: string, fields: CharactershipPatch): void
	removeCharactership(id: string): void
}

export type RelationshipTypeValues = {
	readonly name: string
	readonly selfLabel: string
	readonly targetLabel: string
	readonly kind: string
	readonly hierarchyFrom: string | null
	readonly position: number
	readonly intro: string
	readonly color: string
	readonly pinned: boolean
}

export type RelationshipTypePatch = Partial<
	Pick<
		typeof relationshipTypes.$inferInsert,
		| "name"
		| "selfLabel"
		| "targetLabel"
		| "kind"
		| "hierarchyFrom"
		| "position"
		| "intro"
		| "color"
		| "pinned"
		| "updatedAt"
	>
>

export type CharactershipValues = {
	readonly typeId: string
	readonly selfId: string | null
	readonly targetId: string | null
	readonly externalName: string
	readonly notes: string
	readonly metadata: string
}

export type CharactershipPatch = Partial<
	Pick<typeof characterships.$inferInsert, "notes" | "metadata">
>

export function buildRelationshipRepository(
	client: DbClient,
): RelationshipRepository {
	function findTypeById(id: string): RelationshipTypeRow {
		const row = client
			.select()
			.from(relationshipTypes)
			.where(eq(relationshipTypes.id, id))
			.get()
		if (!row) {
			throw notFound(
				"relationship_type.not_found",
				`relationship type ${id} not found`,
				{ id },
			)
		}
		return row
	}

	function listTypes(): readonly RelationshipTypeRow[] {
		return client
			.select()
			.from(relationshipTypes)
			.orderBy(asc(relationshipTypes.position), asc(relationshipTypes.name))
			.all()
	}

	function insertType(
		id: string,
		values: RelationshipTypeValues,
		ts: number,
	): void {
		client
			.insert(relationshipTypes)
			.values({
				id,
				name: values.name,
				selfLabel: values.selfLabel,
				targetLabel: values.targetLabel,
				kind: values.kind,
				hierarchyFrom: values.hierarchyFrom,
				position: values.position,
				intro: values.intro,
				color: values.color,
				pinned: values.pinned,
				createdAt: ts,
				updatedAt: ts,
			})
			.run()
	}

	function patchType(id: string, fields: RelationshipTypePatch): void {
		client
			.update(relationshipTypes)
			.set(fields)
			.where(eq(relationshipTypes.id, id))
			.run()
	}

	function removeType(id: string): void {
		client.delete(relationshipTypes).where(eq(relationshipTypes.id, id)).run()
	}

	function countCharactershipUsages(typeId: string): number {
		const row = client
			.select({ value: count() })
			.from(characterships)
			.where(eq(characterships.typeId, typeId))
			.get()
		return row?.value ?? 0
	}

	function findCharactershipById(id: string): CharactershipRow {
		const row = client
			.select()
			.from(characterships)
			.where(eq(characterships.id, id))
			.get()
		if (!row) {
			throw notFound(
				"charactership.not_found",
				`charactership ${id} not found`,
				{ id },
			)
		}
		return row
	}

	function listCharactershipsForCharacter(
		charId: string,
	): readonly CharactershipRow[] {
		return client
			.select()
			.from(characterships)
			.where(
				or(
					eq(characterships.selfId, charId),
					eq(characterships.targetId, charId),
				),
			)
			.orderBy(asc(characterships.createdAt))
			.all()
	}

	function listCharactershipsForCharacters(
		charIds: readonly string[],
	): readonly CharactershipRow[] {
		if (charIds.length === 0) return []
		const idList = [...charIds]
		return client
			.select()
			.from(characterships)
			.where(
				or(
					inArray(characterships.selfId, idList),
					inArray(characterships.targetId, idList),
				),
			)
			.orderBy(asc(characterships.createdAt))
			.all()
	}

	function listAllCharacterships(): readonly CharactershipRow[] {
		return client
			.select()
			.from(characterships)
			.orderBy(asc(characterships.createdAt))
			.all()
	}

	function insertCharactership(
		id: string,
		values: CharactershipValues,
		ts: number,
	): void {
		client
			.insert(characterships)
			.values({
				id,
				typeId: values.typeId,
				selfId: values.selfId,
				targetId: values.targetId,
				externalName: values.externalName,
				notes: values.notes,
				metadata: values.metadata,
				createdAt: ts,
			})
			.run()
	}

	function patchCharactership(id: string, fields: CharactershipPatch): void {
		client
			.update(characterships)
			.set(fields)
			.where(eq(characterships.id, id))
			.run()
	}

	function removeCharactership(id: string): void {
		client.delete(characterships).where(eq(characterships.id, id)).run()
	}

	return {
		findTypeById,
		listTypes,
		insertType,
		patchType,
		removeType,
		countCharactershipUsages,
		findCharactershipById,
		listCharactershipsForCharacter,
		listCharactershipsForCharacters,
		listAllCharacterships,
		removeCharactership,
		insertCharactership,
		patchCharactership,
	}
}
