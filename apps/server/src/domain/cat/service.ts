import type {
	Category,
	CatKind,
	EntityMetaCreateInput,
	EntityMetaUpdateInput,
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
	buildCategoryRepository,
	type CatDbPatch,
	type CatRow,
} from "./repo.ts"

export type CatServiceDeps = DbServiceDeps

export type CatCreateInput = EntityMetaCreateInput & {
	readonly kind: CatKind
}

export type CatUpdateInput = EntityMetaUpdateInput

export type CatWithCounts = Category & { readonly tagCount: number }

/**
 * Behaviour contract for the category module (the user-visible
 * "namespace"). Categories are flat and hard-deleted only (no soft-delete,
 * no parent/child relationships). Namespace names are globally unique
 * (trim, exact match), enforced here with a friendly "already exists"
 * error and backed by a DB unique index.
 */
export type CatService = {
	listAll(): Promise<readonly Category[]>
	listAllWithCounts(): Promise<readonly CatWithCounts[]>
	detail(id: string): Promise<Category>
	create(input: CatCreateInput): Promise<Category>
	update(input: CatUpdateInput): Promise<Category>
	reorder(kind: CatCreateInput["kind"], ids: readonly string[]): Promise<void>
	delete(id: string): Promise<void>
	forceDelete(id: string, confirmName: string): Promise<void>
}

export function createCategoryService(deps: CatServiceDeps): CatService {
	const repo = buildCategoryRepository(deps.db)
	const { now, newId } = resolveClock(deps)

	function listAll(): readonly Category[] {
		return repo.listAll().map(rowToCategory)
	}

	function listAllWithCounts(): readonly CatWithCounts[] {
		const counts = repo.tagCountsByCategory()
		return repo.listAll().map((row) => ({
			...rowToCategory(row),
			tagCount: counts.get(row.id) ?? 0,
		}))
	}

	function detail(id: string): Category {
		return rowToCategory(repo.findById(id))
	}

	function maxPositionForKind(kind: CatCreateInput["kind"]): number {
		return buildMaxPosition(repo.listAll, (c) => c.kind === kind)()
	}

	function create(input: CatCreateInput): Category {
		assertNameAvailable(input.name)
		const id = newId()
		const ts = now()
		const meta = resolveEntityMetaInsert(input, maxPositionForKind(input.kind))
		repo.insert(
			id,
			{
				name: input.name,
				...meta,
				kind: input.kind,
			},
			ts,
		)
		return rowToCategory(repo.findById(id))
	}

	function update(input: CatUpdateInput): Category {
		const current = repo.findById(input.id)
		if (input.name !== undefined && input.name.trim() !== current.name.trim()) {
			assertNameAvailable(input.name, input.id)
		}
		const patch: CatDbPatch = buildEntityMetaPatch(input, now())
		repo.patch(input.id, patch)
		return rowToCategory(repo.findById(input.id))
	}

	/**
	 * Namespace names are globally unique: trim + exact + case-sensitive
	 * per the PRD. Renaming onto an existing name is rejected so the UI
	 * can offer a tag merge instead of silently creating a duplicate.
	 */
	function assertNameAvailable(name: string, excludeId?: string): void {
		const normalized = name.trim()
		const existing = repo
			.listAll()
			.find((c) => c.name.trim() === normalized && c.id !== excludeId)
		if (existing === undefined) return
		throw conflict(
			"category.name_exists",
			`a namespace named "${normalized}" already exists`,
			{ name: normalized, existingId: existing.id },
		)
	}

	function reorder(kind: CatCreateInput["kind"], ids: readonly string[]): void {
		buildReorder<CatRow>({
			entity: "category",
			listAll: repo.listAll,
			patch: repo.patch,
			now,
			filter: (c) => c.kind === kind,
			filterMeta: { kind },
		})(ids)
	}

	function deleteCategory(id: string): void {
		repo.findById(id)
		const tagCount = repo.countTags(id)
		if (tagCount > 0) {
			throw conflict(
				"category.has_dependencies",
				`category ${id} has ${tagCount} tag(s)`,
				{ id, tags: tagCount },
			)
		}
		repo.remove(id)
	}

	function forceDelete(id: string, confirmName: string): void {
		buildForceDelete({
			entity: "category",
			findById: repo.findById,
			remove: repo.remove,
		})(id, confirmName)
	}

	return wrapAsync({
		listAll,
		listAllWithCounts,
		detail,
		create,
		update,
		reorder,
		delete: deleteCategory,
		forceDelete,
	})
}

function rowToCategory(row: CatRow): Category {
	return {
		id: row.id,
		name: row.name,
		intro: row.intro,
		color: row.color,
		kind: row.kind,
		position: row.position,
		pinned: row.pinned,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}
}
