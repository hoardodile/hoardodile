import { asc, count, eq } from "drizzle-orm"
import { tags } from "src/domain/tag/schema.ts"
import {
	buildFindById,
	buildInsert,
	buildListAll,
	buildPatch,
	buildRemove,
} from "src/infra/db/builders.ts"
import type { DbClient } from "src/infra/db/connection.ts"
import { categories } from "./schema.ts"

export type CatRow = typeof categories.$inferSelect

export type CatDbValues = {
	readonly name: string
	readonly intro: string
	readonly color: string
	readonly kind: "common" | "resource" | "character"
	readonly position: number
	readonly pinned: boolean
}

export type CatDbPatch = Partial<
	Pick<
		typeof categories.$inferInsert,
		"name" | "intro" | "color" | "position" | "pinned" | "updatedAt"
	>
>

/**
 * Pure Drizzle query layer for the category module.
 */
export type CatRepository = {
	/** @throws {DomainError} NOT_FOUND when the row is missing. */
	findById(id: string): CatRow
	listAll(): readonly CatRow[]
	insert(id: string, values: CatDbValues, ts: number): void
	patch(id: string, fields: CatDbPatch): void
	remove(id: string): void
	countTags(catId: string): number
	/** Returns a map of `catId → tag count` for every category. */
	tagCountsByCategory(): ReadonlyMap<string, number>
}

export function buildCategoryRepository(client: DbClient): CatRepository {
	const findById = buildFindById<CatRow>(client, categories, "category")
	const listAll = buildListAll<CatRow>(client, categories, [
		asc(categories.position),
	])
	const insert = buildInsert<CatDbValues>(client, categories)
	const patch = buildPatch<CatDbPatch>(client, categories)
	const remove = buildRemove(client, categories)

	function countTags(catId: string): number {
		const row = client
			.select({ value: count() })
			.from(tags)
			.where(eq(tags.catId, catId))
			.get()
		return row?.value ?? 0
	}

	function tagCountsByCategory(): ReadonlyMap<string, number> {
		const rows = client
			.select({ catId: tags.catId, value: count() })
			.from(tags)
			.groupBy(tags.catId)
			.all()
		const map = new Map<string, number>()
		for (const row of rows) {
			if (row.catId !== null) map.set(row.catId, row.value)
		}
		return map
	}

	return {
		findById,
		listAll,
		insert,
		patch,
		remove,
		countTags,
		tagCountsByCategory,
	}
}
