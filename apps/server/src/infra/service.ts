import { randomUUID } from "node:crypto"
import { DEFAULT_PAGE_SIZE } from "@hoardodile/schemas/page"
import type { ListPageInput } from "@hoardodile/shared"
import { conflict } from "@hoardodile/shared"
import { keyBy } from "es-toolkit"
import type { SqliteDb } from "./db/connection.ts"

/**
 * Test-seam overrides shared by all service factories. In production both
 * default to platform implementations; tests inject deterministic stubs.
 */
export type ClockDeps = {
	/** @default Date.now */
	readonly now?: () => number
	/** @default generateId */
	readonly newId?: () => string
}

/**
 * Common deps for service factories that need a DB handle plus clock
 * overrides. Most domain services extend this type.
 */
export type DbServiceDeps = ClockDeps & {
	readonly db: SqliteDb
}

/**
 * Default id generator used by all service factories when no test-seam
 * override is provided via {@link ClockDeps.newId}.
 */
export function generateId(): string {
	return randomUUID()
}

/**
 * Clamp page/size from a {@link ListPageInput} to the caller-supplied
 * `maxSize` cap. Centralises the two-liner that was copy-pasted across
 * every paginating service.
 *
 * @param input - The raw list page input from the tRPC caller.
 * @param maxSize - Upper bound for `size` (e.g. 200).
 * @returns Resolved `{ page, size }` ready for use in DB queries.
 */
export function applyPageBounds(
	input: Pick<ListPageInput, "page" | "size">,
	maxSize: number,
): { page: number; size: number } {
	const page = input.page ?? 1
	const size = Math.min(input.size ?? DEFAULT_PAGE_SIZE, maxSize)
	return { page, size }
}

type SoftDeletableRepo<TRow extends { deletedAt: number | null }> = {
	findById(id: string): TRow
	patch(
		id: string,
		fields: { deletedAt?: number | null; updatedAt?: number },
	): void
}

type SoftDeleteOpsConfig<TRow extends { deletedAt: number | null }, T> = {
	readonly entity: string
	readonly repo: SoftDeletableRepo<TRow>
	readonly mapper: (row: TRow) => T
	readonly now: () => number
}

export type SoftDeleteOps<T> = {
	softDelete(id: string): T
	restore(id: string): T
}

/**
 * Build the soft-delete / restore operation pair for any entity whose DB row
 * has a nullable `deletedAt` column. Hard delete is intentionally excluded
 * because it differs per entity (file-backed vs. row-only).
 *
 * @throws {DomainError} CONFLICT on invariant violations (already-trashed, not-trashed).
 */
export function buildSoftDeleteOps<
	TRow extends { deletedAt: number | null },
	T,
>(config: SoftDeleteOpsConfig<TRow, T>): SoftDeleteOps<T> {
	const { entity, repo, mapper, now } = config

	function softDelete(id: string): T {
		const row = repo.findById(id)
		if (row.deletedAt !== null) {
			throw conflict(
				`${entity}.already_trashed`,
				`${entity} ${id} is already in the trash`,
				{ id },
			)
		}
		const ts = now()
		repo.patch(id, { deletedAt: ts, updatedAt: ts })
		return mapper(repo.findById(id))
	}

	function restore(id: string): T {
		const row = repo.findById(id)
		if (row.deletedAt === null) {
			throw conflict(
				`${entity}.not_trashed`,
				`${entity} ${id} is not in the trash`,
				{ id },
			)
		}
		const ts = now()
		repo.patch(id, { deletedAt: null, updatedAt: ts })
		return mapper(repo.findById(id))
	}

	return { softDelete, restore }
}

/**
 * Map a sync function to its async counterpart, preserving args and
 * unwrapping any already-Promise return type so the result is always
 * `Promise<Awaited<R>>`.
 */
type Promisify<F> = F extends (...args: infer A) => infer R
	? (...args: A) => Promise<Awaited<R>>
	: never

/**
 * Promisified view of a sync service implementation: every function
 * value becomes async. Non-function values are dropped (services only
 * expose functions).
 */
export type Promisified<T> = {
	[K in keyof T]: T[K] extends (...args: never[]) => unknown
		? Promisify<T[K]>
		: never
}

/**
 * Wrap a record of sync (or already-async) implementation functions
 * into an object whose every method returns a Promise. Eliminates the
 * `return { listAll: async () => listAll(), detail: async (id) => detail(id), ... }`
 * boilerplate at the bottom of every service factory.
 *
 * @example
 *   return wrapAsync({ listAll, detail, create, update, delete: deleteX })
 */
export function wrapAsync<
	T extends Record<string, (...args: never[]) => unknown>,
>(impl: T): Promisified<T> {
	const out: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
	for (const key of Object.keys(impl)) {
		const fn = impl[key] as (...args: unknown[]) => unknown
		out[key] = async function asyncWrapped(...args) {
			return fn(...args)
		}
	}
	return out as Promisified<T>
}

/**
 * Strip keys whose value is `undefined` from an object literal. Used by
 * service `update()` methods to convert a partial input into the patch
 * payload fed to `repo.patch()`, replacing the
 * `if (input.x !== undefined) draft.x = input.x` ladder.
 *
 * Type-level signature: keeps every key of `T` but makes them all
 * optional, since runtime omission of `undefined` values is exactly
 * what `Partial<T>` expresses.
 */
export function filterDefined<T extends Record<string, unknown>>(
	input: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
	const out: Record<string, unknown> = {}
	for (const key of Object.keys(input)) {
		const v = input[key]
		if (v !== undefined) out[key] = v
	}
	return out as { [K in keyof T]?: Exclude<T[K], undefined> }
}

export type EntityMetaInsertInput = {
	readonly intro?: string
	readonly color?: string
	readonly position?: number
	readonly pinned?: boolean
}

export type EntityMetaPatchInput = EntityMetaInsertInput & {
	readonly name?: string
}

/** Default intro/color/pinned/position values for entity create. */
export function resolveEntityMetaInsert(
	input: EntityMetaInsertInput,
	maxPosition: number,
): {
	readonly intro: string
	readonly color: string
	readonly position: number
	readonly pinned: boolean
} {
	return {
		intro: input.intro ?? "",
		color: input.color ?? "",
		position: input.position ?? maxPosition + 1,
		pinned: input.pinned ?? false,
	}
}

/** Partial meta patch with `updatedAt` for entity update. */
export function buildEntityMetaPatch(
	input: EntityMetaPatchInput,
	updatedAt: number,
): {
	[K in keyof EntityMetaPatchInput]?: Exclude<
		EntityMetaPatchInput[K],
		undefined
	>
} & {
	readonly updatedAt: number
} {
	return {
		...filterDefined({
			name: input.name,
			intro: input.intro,
			color: input.color,
			position: input.position,
			pinned: input.pinned,
		}),
		updatedAt,
	}
}

/**
 * Resolve clock overrides from {@link ClockDeps}, falling back to platform
 * defaults. Replaces the repeated `deps.now ?? Date.now` /
 * `deps.newId ?? generateId` pair at the top of every service factory.
 */
export function resolveClock(deps: ClockDeps) {
	return { now: deps.now ?? Date.now, newId: deps.newId ?? generateId }
}

type ReorderConfig<TRow extends { id: string; position: number }> = {
	readonly entity: string
	readonly listAll: () => readonly TRow[]
	readonly patch: (
		id: string,
		fields: { position: number; updatedAt: number },
	) => void
	readonly now: () => number
	readonly filter?: (row: TRow) => boolean
	readonly filterMeta?: Record<string, unknown>
}

/**
 * Build a `reorder(ids)` function that rewrites `position` to `0..n-1`
 * for a set of existing rows. Validates that `ids` is a permutation of
 * every matching row (no duplicates, no missing, no unknown ids).
 *
 * @example
 *   const reorder = buildReorder<CatRow>({
 *     entity: "category",
 *     listAll: repo.listAll,
 *     patch: repo.patch,
 *     now,
 *     filter: (c) => c.kind === kind,
 *     filterMeta: { kind },
 *   })
 */
export function buildReorder<TRow extends { id: string; position: number }>(
	config: ReorderConfig<TRow>,
): (ids: readonly string[]) => void {
	const { entity, listAll, patch, now, filter, filterMeta } = config
	return function reorder(ids) {
		const unique = new Set(ids)
		if (unique.size !== ids.length) {
			throw conflict(
				`${entity}.reorder.duplicate_ids`,
				"duplicate ids",
				filterMeta ?? {},
			)
		}
		const allRows = listAll()
		const existing = filter ? allRows.filter(filter) : allRows
		if (existing.length !== ids.length) {
			throw conflict(
				`${entity}.reorder.mismatch`,
				`ids length ${ids.length} does not match existing ${existing.length}`,
				{
					...filterMeta,
					expected: existing.map((r) => r.id),
					got: ids,
				},
			)
		}
		const byId = keyBy(existing, (r) => r.id)
		for (const id of ids) {
			if (byId[id] === undefined) {
				throw conflict(`${entity}.reorder.unknown_id`, `unknown id ${id}`, {
					...filterMeta,
					id,
				})
			}
		}
		const ts = now()
		for (let i = 0; i < ids.length; i++) {
			const id = ids[i]
			if (id === undefined) continue
			const row = byId[id]
			if (row === undefined) continue
			if (row.position === i) continue
			patch(id, { position: i, updatedAt: ts })
		}
	}
}

/**
 * Build a `forceDelete(id, confirmName)` function that removes a row
 * only after the caller confirms its exact name. Throws a CONFLICT
 * error on mismatch.
 *
 * @example
 *   const forceDelete = buildForceDelete({
 *     entity: "category",
 *     findById: repo.findById,
 *     remove: repo.remove,
 *   })
 */
export function buildForceDelete<
	TRow extends { id: string; name: string },
>(config: {
	readonly entity: string
	readonly findById: (id: string) => TRow
	readonly remove: (id: string) => void
}): (id: string, confirmName: string) => void {
	const { entity, findById, remove } = config
	return function forceDelete(id, confirmName) {
		const row = findById(id)
		if (confirmName !== row.name) {
			throw conflict(
				`${entity}.confirm_name_mismatch`,
				`provided name "${confirmName}" does not match ${entity} name`,
				{ id, expected: row.name },
			)
		}
		remove(id)
	}
}

/**
 * Build a `maxPosition()` helper that returns the highest `position`
 * value among matching rows, or `-1` when none exist.
 *
 * @example
 *   const maxPosition = buildMaxPosition(repo.listAll, (c) => c.kind === kind)
 */
export function buildMaxPosition<TRow extends { position: number }>(
	listAll: () => readonly TRow[],
	filter?: (row: TRow) => boolean,
): () => number {
	return function maxPosition() {
		const rows = listAll()
		const matching = filter ? rows.filter(filter) : rows
		return matching.length > 0
			? Math.max(...matching.map((r) => r.position))
			: -1
	}
}
