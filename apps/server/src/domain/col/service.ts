import type {
	EntityMetaCreateInput,
	EntityMetaUpdateInput,
	ResCollection,
} from "@hoardodile/schemas"
import { conflict, notFound } from "@hoardodile/shared"
import { and, eq, sql } from "drizzle-orm"
import { resources } from "src/domain/res/schema.ts"
import { type DbClient, withTransaction } from "src/infra/db/connection.ts"
import {
	buildEntityMetaPatch,
	buildForceDelete,
	buildMaxPosition,
	buildReorder,
	type DbServiceDeps,
	resolveClock,
	resolveEntityMetaInsert,
	wrapAsync,
} from "src/infra/service.ts"
import {
	buildResourceCollectionRepository,
	type ResCollectionDbPatch,
	type ResCollectionRow,
} from "./repo.ts"
import { resCollectionItems } from "./schema.ts"

export type ResCollectionServiceDeps = DbServiceDeps

export type ResCollectionCreateInput = EntityMetaCreateInput

export type ResCollectionUpdateInput = EntityMetaUpdateInput

export type ResCollectionWithCounts = ResCollection & {
	readonly resCount: number
}

/**
 * Behaviour contract for the resource-collection module. Collections are
 * hard-deleted only (`delete` rejects when items remain; `forceDelete`
 * cascades). Attach/detach operations are idempotent.
 */
export type ResCollectionService = {
	listAll(): Promise<readonly ResCollection[]>
	listAllWithCounts(): Promise<readonly ResCollectionWithCounts[]>
	detail(id: string): Promise<ResCollection>
	create(input: ResCollectionCreateInput): Promise<ResCollection>
	update(input: ResCollectionUpdateInput): Promise<ResCollection>
	delete(id: string): Promise<void>
	forceDelete(id: string, confirmName: string): Promise<void>

	/** Resource ids ordered by `position`, then `createdAt`. */
	listResourceIdsIn(colId: string): Promise<readonly string[]>
	/** Collections that contain the given resource. */
	listForResource(resId: string): Promise<readonly ResCollection[]>
	attach(colId: string, resId: string): Promise<void>
	detach(colId: string, resId: string): Promise<void>
	/**
	 * Reorder collections globally: `ids` must be a permutation of every
	 * collection id. Positions are rewritten to `0..n-1`.
	 */
	reorder(ids: readonly string[]): Promise<void>
	/**
	 * Reorder resources inside one collection: `resIds` must be a permutation
	 * of the current members of `colId`.
	 */
	reorderResources(colId: string, resIds: readonly string[]): Promise<void>
}

export function createResourceCollectionService(
	deps: ResCollectionServiceDeps,
): ResCollectionService {
	const repo = buildResourceCollectionRepository(deps.db)
	const { now, newId } = resolveClock(deps)

	function listAll(): readonly ResCollection[] {
		return repo.listAll().map(rowToCollection)
	}

	function listAllWithCounts(): readonly ResCollectionWithCounts[] {
		const counts = repo.resUsageCounts()
		return repo.listAll().map((row) => ({
			...rowToCollection(row),
			resCount: counts.get(row.id) ?? 0,
		}))
	}

	function detail(id: string): ResCollection {
		return rowToCollection(repo.findById(id))
	}

	function maxCollectionPosition(): number {
		return buildMaxPosition(repo.listAll)()
	}

	function create(input: ResCollectionCreateInput): ResCollection {
		const id = newId()
		const ts = now()
		const name = input.name.trim()
		assertNameAvailable(name, undefined)
		const meta = resolveEntityMetaInsert(input, maxCollectionPosition())
		repo.insert(
			id,
			{
				name,
				...meta,
			},
			ts,
		)
		return rowToCollection(repo.findById(id))
	}

	function update(input: ResCollectionUpdateInput): ResCollection {
		repo.findById(input.id)
		if (input.name !== undefined) {
			const name = input.name.trim()
			assertNameAvailable(name, input.id)
		}
		const patch: ResCollectionDbPatch = buildEntityMetaPatch(
			{
				...input,
				name: input.name === undefined ? undefined : input.name.trim(),
			},
			now(),
		)
		repo.patch(input.id, patch)
		return rowToCollection(repo.findById(input.id))
	}

	function assertNameAvailable(
		name: string,
		excludeId: string | undefined,
	): void {
		if (name.length === 0) {
			throw conflict(
				"resCollection.invalid_name",
				"collection name cannot be empty",
				{ name },
			)
		}
		const lower = name.toLowerCase()
		const clash = repo
			.listAll()
			.find(
				(row) =>
					row.name.trim().toLowerCase() === lower && row.id !== excludeId,
			)
		if (clash !== undefined) {
			throw conflict(
				"resCollection.duplicate_name",
				`collection name "${name}" already exists`,
				{ name, existingId: clash.id },
			)
		}
	}

	function deleteCollection(id: string): void {
		repo.findById(id)
		const used = repo.countResourceUsages(id)
		if (used > 0) {
			throw conflict(
				"resCollection.has_dependencies",
				`collection ${id} contains ${used} resource(s)`,
				{ id, resources: used },
			)
		}
		repo.remove(id)
	}

	function forceDelete(id: string, confirmName: string): void {
		buildForceDelete({
			entity: "resCollection",
			findById: repo.findById,
			remove: repo.remove,
		})(id, confirmName)
	}

	function touchResource(client: DbClient, resId: string): void {
		client
			.update(resources)
			.set({ updatedAt: now() })
			.where(eq(resources.id, resId))
			.run()
	}

	function maxPosition(client: DbClient, colId: string): number {
		const row = client
			.select({
				value: sql<number | null>`MAX(${resCollectionItems.position})`,
			})
			.from(resCollectionItems)
			.where(eq(resCollectionItems.colId, colId))
			.get()
		return row?.value ?? -1
	}

	function attach(colId: string, resId: string): void {
		repo.findById(colId)
		assertResourceExists(resId)
		withTransaction(deps.db, (tx) => {
			const next = maxPosition(tx, colId) + 1
			tx.insert(resCollectionItems)
				.values({ colId, resId, position: next, createdAt: now() })
				.onConflictDoNothing()
				.run()
			touchResource(tx, resId)
			const txRepo = buildResourceCollectionRepository(tx)
			txRepo.patch(colId, { updatedAt: now() })
		})
	}

	function detach(colId: string, resId: string): void {
		repo.findById(colId)
		withTransaction(deps.db, (tx) => {
			tx.delete(resCollectionItems)
				.where(
					and(
						eq(resCollectionItems.colId, colId),
						eq(resCollectionItems.resId, resId),
					),
				)
				.run()
			touchResource(tx, resId)
			const txRepo = buildResourceCollectionRepository(tx)
			txRepo.patch(colId, { updatedAt: now() })
		})
	}

	function reorder(ids: readonly string[]): void {
		buildReorder<ResCollectionRow>({
			entity: "resCollection",
			listAll: repo.listAll,
			patch: repo.patch,
			now,
		})(ids)
	}

	function reorderResources(colId: string, resIds: readonly string[]): void {
		repo.findById(colId)
		const current = new Set(repo.listResourceIdsIn(colId))
		if (current.size !== resIds.length) {
			throw conflict(
				"resCollection.reorderResources.mismatch",
				`reorder list has ${resIds.length} ids; collection has ${current.size}`,
				{ id: colId },
			)
		}
		for (const rid of resIds) {
			if (!current.has(rid)) {
				throw conflict(
					"resCollection.reorderResources.unknown_member",
					`resource ${rid} is not a member of collection ${colId}`,
					{ id: colId, resId: rid },
				)
			}
		}
		withTransaction(deps.db, (tx) => {
			resIds.forEach((rid, idx) => {
				tx.update(resCollectionItems)
					.set({ position: idx })
					.where(
						and(
							eq(resCollectionItems.colId, colId),
							eq(resCollectionItems.resId, rid),
						),
					)
					.run()
			})
			const txRepo = buildResourceCollectionRepository(tx)
			txRepo.patch(colId, { updatedAt: now() })
		})
	}

	function assertResourceExists(resId: string): void {
		const row = deps.db
			.select({ id: resources.id })
			.from(resources)
			.where(eq(resources.id, resId))
			.get()
		if (row === undefined) {
			throw notFound("resource.not_found", `resource ${resId} does not exist`, {
				id: resId,
			})
		}
	}

	const asyncOps = wrapAsync({
		listAll,
		listAllWithCounts,
		detail,
		create,
		update,
		delete: deleteCollection,
		forceDelete,
		attach,
		detach,
		reorder,
		reorderResources,
	})
	return {
		...asyncOps,
		listResourceIdsIn: async (id) => repo.listResourceIdsIn(id),
		listForResource: async (id) =>
			repo.listForResource(id).map(rowToCollection),
	}
}

function rowToCollection(row: ResCollectionRow): ResCollection {
	return {
		id: row.id,
		name: row.name,
		intro: row.intro,
		color: row.color,
		position: row.position,
		pinned: row.pinned,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}
}
