import type {
	EntityMetaCreateInput,
	EntityMetaUpdateInput,
	TraitDef,
	TraitKind,
} from "@hoardodile/schemas"
import { conflict } from "@hoardodile/shared"
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
	buildTraitRepository,
	type TraitDefDbPatch,
	type TraitDefRow,
} from "./repo.ts"

export type TraitServiceDeps = DbServiceDeps

export type TraitCreateInput = EntityMetaCreateInput & {
	readonly kind: TraitKind
}

export type TraitUpdateInput = EntityMetaUpdateInput

export type TraitDefWithCounts = TraitDef & {
	readonly charCount: number
}

/**
 * Behaviour contract for the trait module. Traits are hard-deleted only
 * (no soft-delete). The `kind` of an existing trait is immutable; clients
 * must delete and recreate to change the type.
 */
export type TraitService = {
	listAll(): Promise<readonly TraitDef[]>
	listAllWithCounts(): Promise<readonly TraitDefWithCounts[]>
	detail(id: string): Promise<TraitDef>
	create(input: TraitCreateInput): Promise<TraitDef>
	update(input: TraitUpdateInput): Promise<TraitDef>
	delete(id: string): Promise<void>
	forceDelete(id: string, confirmName: string): Promise<void>
	reorder(ids: readonly string[]): Promise<void>
}

/**
 * Build a {@link TraitService} backed by a {@link TraitRepository}. The
 * closure captures its deps so every call stays within the same DB handle;
 * no module-level singletons, which keeps tests parallel-safe.
 */
export function createTraitService(deps: TraitServiceDeps): TraitService {
	const repo = buildTraitRepository(deps.db)
	const { now, newId } = resolveClock(deps)

	function listAll(): readonly TraitDef[] {
		return repo.listAll().map(rowToTraitDef)
	}

	function listAllWithCounts(): readonly TraitDefWithCounts[] {
		return repo.listAll().map((row) => ({
			...rowToTraitDef(row),
			charCount: repo.countCharacterUsages(row.id),
		}))
	}

	function detail(id: string): TraitDef {
		return rowToTraitDef(repo.findById(id))
	}

	function maxPosition(): number {
		return buildMaxPosition(repo.listAll)()
	}

	function create(input: TraitCreateInput): TraitDef {
		const existing = repo.findByName(input.name)
		if (existing !== undefined) {
			throw conflict(
				"trait.name_conflict",
				`a trait named "${input.name}" already exists`,
				{ name: input.name },
			)
		}
		const id = newId()
		const ts = now()
		const meta = resolveEntityMetaInsert(input, maxPosition())
		repo.insert(
			id,
			{
				name: input.name,
				kind: input.kind,
				...meta,
			},
			ts,
		)
		return rowToTraitDef(repo.findById(id))
	}

	function update(input: TraitUpdateInput): TraitDef {
		const row = repo.findById(input.id)
		if (input.name !== undefined && input.name !== row.name) {
			const existing = repo.findByName(input.name)
			if (existing !== undefined) {
				throw conflict(
					"trait.name_conflict",
					`a trait named "${input.name}" already exists`,
					{ name: input.name },
				)
			}
		}
		const patch: TraitDefDbPatch = buildEntityMetaPatch(input, now())
		repo.patch(input.id, patch)
		return rowToTraitDef(repo.findById(input.id))
	}

	function deleteTrait(id: string): void {
		repo.findById(id)
		const usages = repo.countCharacterUsages(id)
		if (usages > 0) {
			throw conflict(
				"trait.has_dependencies",
				`trait ${id} is in use by ${usages} character(s)`,
				{ id, characters: usages },
			)
		}
		repo.remove(id)
	}

	function forceDelete(id: string, confirmName: string): void {
		buildForceDelete({
			entity: "trait",
			findById: repo.findById,
			remove: repo.remove,
		})(id, confirmName)
	}

	function reorder(ids: readonly string[]): void {
		buildReorder<TraitDefRow>({
			entity: "trait",
			listAll: repo.listAll,
			patch: repo.patch,
			now,
		})(ids)
	}

	return wrapAsync({
		listAll,
		listAllWithCounts,
		detail,
		create,
		update,
		delete: deleteTrait,
		forceDelete,
		reorder,
	})
}

function rowToTraitDef(row: TraitDefRow): TraitDef {
	return {
		id: row.id,
		name: row.name,
		kind: row.kind,
		position: row.position,
		pinned: row.pinned,
		color: row.color,
		intro: row.intro,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}
}
