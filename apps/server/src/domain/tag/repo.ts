import { asc, count, eq, inArray } from "drizzle-orm"
import {
	buildFindById,
	buildInsert,
	buildListAll,
	buildPatch,
	buildRemove,
} from "src/infra/db/builders.ts"
import type { DbClient } from "src/infra/db/connection.ts"
import { charTags, resTags, tags } from "./schema.ts"

export type TagRow = typeof tags.$inferSelect

export type TagDbValues = {
	readonly name: string
	readonly intro: string
	readonly color: string
	readonly position: number
	readonly pinned: boolean
	readonly catId: string | null
}

export type TagDbPatch = Partial<
	Pick<
		typeof tags.$inferInsert,
		"name" | "intro" | "color" | "position" | "pinned" | "catId" | "updatedAt"
	>
>

/**
 * Pure Drizzle query layer for the tag module. Handles both the `tags` table
 * and the two join tables (resource_tags, character_tags).
 */
export type TagRepository = {
	/** @throws {DomainError} NOT_FOUND when the row is missing. */
	findById(id: string): TagRow
	listAll(): readonly TagRow[]
	insert(id: string, values: TagDbValues, ts: number): void
	patch(id: string, fields: TagDbPatch): void
	remove(id: string): void

	countResourceUsages(tagId: string): number
	countCharacterUsages(tagId: string): number
	resUsageCounts(): ReadonlyMap<string, number>
	charUsageCounts(): ReadonlyMap<string, number>

	listForResource(resId: string): readonly TagRow[]
	listForCharacter(charId: string): readonly TagRow[]

	listForManyResources(
		ids: readonly string[],
	): readonly { resId: string; tagId: string }[]
	listForManyCharacters(
		ids: readonly string[],
	): readonly { charId: string; tagId: string }[]
}

export function buildTagRepository(client: DbClient): TagRepository {
	const findById = buildFindById<TagRow>(client, tags, "tag")
	const listAll = buildListAll<TagRow>(client, tags, [asc(tags.position)])
	const insert = buildInsert<TagDbValues>(client, tags)
	const patch = buildPatch<TagDbPatch>(client, tags)
	const remove = buildRemove(client, tags)

	function listForResource(resId: string): readonly TagRow[] {
		return client
			.select({ tags })
			.from(resTags)
			.innerJoin(tags, eq(resTags.tagId, tags.id))
			.where(eq(resTags.resId, resId))
			.orderBy(asc(tags.position))
			.all()
			.map((r) => r.tags)
	}

	function listForCharacter(charId: string): readonly TagRow[] {
		return client
			.select({ tags })
			.from(charTags)
			.innerJoin(tags, eq(charTags.tagId, tags.id))
			.where(eq(charTags.charId, charId))
			.orderBy(asc(tags.position))
			.all()
			.map((r) => r.tags)
	}

	function listForManyResources(
		ids: readonly string[],
	): readonly { resId: string; tagId: string }[] {
		if (ids.length === 0) return []
		return client
			.select({ resId: resTags.resId, tagId: resTags.tagId })
			.from(resTags)
			.where(inArray(resTags.resId, ids))
			.all()
	}

	function listForManyCharacters(
		ids: readonly string[],
	): readonly { charId: string; tagId: string }[] {
		if (ids.length === 0) return []
		return client
			.select({ charId: charTags.charId, tagId: charTags.tagId })
			.from(charTags)
			.where(inArray(charTags.charId, ids))
			.all()
	}

	function countResourceUsages(tagId: string): number {
		const row = client
			.select({ value: count() })
			.from(resTags)
			.where(eq(resTags.tagId, tagId))
			.get()
		return row?.value ?? 0
	}

	function countCharacterUsages(tagId: string): number {
		const row = client
			.select({ value: count() })
			.from(charTags)
			.where(eq(charTags.tagId, tagId))
			.get()
		return row?.value ?? 0
	}

	function resUsageCounts(): ReadonlyMap<string, number> {
		const rows = client
			.select({ tagId: resTags.tagId, value: count() })
			.from(resTags)
			.groupBy(resTags.tagId)
			.all()
		return new Map(rows.map((r) => [r.tagId, r.value]))
	}

	function charUsageCounts(): ReadonlyMap<string, number> {
		const rows = client
			.select({ tagId: charTags.tagId, value: count() })
			.from(charTags)
			.groupBy(charTags.tagId)
			.all()
		return new Map(rows.map((r) => [r.tagId, r.value]))
	}

	return {
		findById,
		listAll,
		insert,
		patch,
		remove,
		countResourceUsages,
		countCharacterUsages,
		resUsageCounts,
		charUsageCounts,
		listForResource,
		listForCharacter,
		listForManyResources,
		listForManyCharacters,
	}
}
