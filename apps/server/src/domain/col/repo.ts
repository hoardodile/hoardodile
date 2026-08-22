import { asc, count, eq } from "drizzle-orm"
import {
	buildFindById,
	buildInsert,
	buildListAll,
	buildPatch,
	buildRemove,
} from "src/infra/db/builders.ts"
import type { DbClient } from "src/infra/db/connection.ts"
import { resCollectionItems, resCollections } from "./schema.ts"

export type ResCollectionRow = typeof resCollections.$inferSelect

export type ResCollectionItemRow = typeof resCollectionItems.$inferSelect

export type ResCollectionDbValues = {
	readonly name: string
	readonly intro: string
	readonly color: string
	readonly position: number
	readonly pinned: boolean
}

export type ResCollectionDbPatch = Partial<
	Pick<
		typeof resCollections.$inferInsert,
		"name" | "intro" | "color" | "position" | "pinned" | "updatedAt"
	>
>

/**
 * Pure Drizzle query layer for the resource-collection module. Handles
 * both the `resource_collections` table and the
 * `resource_collection_items` join table.
 */
export type ResCollectionRepository = {
	/** @throws {DomainError} NOT_FOUND when the row is missing. */
	findById(id: string): ResCollectionRow
	listAll(): readonly ResCollectionRow[]
	insert(id: string, values: ResCollectionDbValues, ts: number): void
	patch(id: string, fields: ResCollectionDbPatch): void
	remove(id: string): void

	countResourceUsages(colId: string): number
	resUsageCounts(): ReadonlyMap<string, number>

	listResourceIdsIn(colId: string): readonly string[]
	listForResource(resId: string): readonly ResCollectionRow[]
}

export function buildResourceCollectionRepository(
	client: DbClient,
): ResCollectionRepository {
	const findById = buildFindById<ResCollectionRow>(
		client,
		resCollections,
		"resCollection",
	)
	const listAll = buildListAll<ResCollectionRow>(client, resCollections, [
		asc(resCollections.position),
	])
	const insert = buildInsert<ResCollectionDbValues>(client, resCollections)
	const patch = buildPatch<ResCollectionDbPatch>(client, resCollections)
	const remove = buildRemove(client, resCollections)

	function listResourceIdsIn(colId: string): readonly string[] {
		return client
			.select({ id: resCollectionItems.resId })
			.from(resCollectionItems)
			.where(eq(resCollectionItems.colId, colId))
			.orderBy(
				asc(resCollectionItems.position),
				asc(resCollectionItems.createdAt),
				asc(resCollectionItems.resId),
			)
			.all()
			.map((r) => r.id)
	}

	function listForResource(resId: string): readonly ResCollectionRow[] {
		return client
			.select({ resCollections })
			.from(resCollectionItems)
			.innerJoin(
				resCollections,
				eq(resCollectionItems.colId, resCollections.id),
			)
			.where(eq(resCollectionItems.resId, resId))
			.all()
			.map((r) => r.resCollections)
	}

	function countResourceUsages(colId: string): number {
		const row = client
			.select({ value: count() })
			.from(resCollectionItems)
			.where(eq(resCollectionItems.colId, colId))
			.get()
		return row?.value ?? 0
	}

	function resUsageCounts(): ReadonlyMap<string, number> {
		const rows = client
			.select({
				colId: resCollectionItems.colId,
				value: count(),
			})
			.from(resCollectionItems)
			.groupBy(resCollectionItems.colId)
			.all()
		return new Map(rows.map((r) => [r.colId, r.value]))
	}

	return {
		findById,
		listAll,
		insert,
		patch,
		remove,
		countResourceUsages,
		resUsageCounts,
		listResourceIdsIn,
		listForResource,
	}
}
