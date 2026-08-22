import { notFound } from "@hoardodile/shared"
import { eq, inArray, type SQL } from "drizzle-orm"
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core"
import type { DbClient } from "./connection.ts"

/**
 * Generic Drizzle repository operation factories used across every
 * domain module. Each builder returns a closed-over function so module
 * repositories drop ~80% of the copy-pasted CRUD boilerplate while
 * keeping precise per-entity row / patch types.
 */

type IdTable = SQLiteTable & { id: SQLiteColumn }

/**
 * Build a `findById(id)` accessor that throws a NOT_FOUND `DomainError`
 * when no row matches. The error `kind` is `<errorKind>.not_found`.
 *
 * @example
 *   const findById = buildFindById<TagRow>(db, tags, "tag")
 */
export function buildFindById<TRow extends { id: string }>(
	client: DbClient,
	table: IdTable,
	errorKind: string,
): (id: string) => TRow {
	return function findById(id) {
		const row = client.select().from(table).where(eq(table.id, id)).get()
		if (!row) {
			throw notFound(`${errorKind}.not_found`, `${errorKind} ${id} not found`, {
				id,
			})
		}
		return row as TRow
	}
}

/**
 * Build a `patch(id, fields)` updater.
 *
 * @example
 *   const patch = buildPatch<TagDbPatch>(db, tags)
 */
export function buildPatch<TPatch extends Record<string, unknown>>(
	client: DbClient,
	table: IdTable,
): (id: string, fields: TPatch) => void {
	return function patch(id, fields) {
		client.update(table).set(fields).where(eq(table.id, id)).run()
	}
}

/** Build a `remove(id)` deleter. */
export function buildRemove(
	client: DbClient,
	table: IdTable,
): (id: string) => void {
	return function remove(id) {
		client.delete(table).where(eq(table.id, id)).run()
	}
}

/**
 * Build an `insert(id, values, ts)` creator that stamps `createdAt` /
 * `updatedAt` timestamps automatically.
 *
 * @example
 *   const insert = buildInsert<CatDbValues>(db, categories)
 */
export function buildInsert<TValues extends Record<string, unknown>>(
	client: DbClient,
	table: IdTable,
): (id: string, values: TValues, ts: number) => void {
	return function insert(id, values, ts) {
		client
			.insert(table)
			.values({ id, ...values, createdAt: ts, updatedAt: ts })
			.run()
	}
}

/**
 * Build a `listAll()` reader. Pass `orderBy` columns to sort the result;
 * omit for an unordered scan.
 *
 * @example
 *   const listAll = buildListAll<TagRow>(db, tags, [asc(tags.position)])
 */
export function buildListAll<TRow>(
	client: DbClient,
	table: IdTable,
	orderBy?: (SQLiteColumn | SQL)[],
): () => readonly TRow[] {
	return function listAll() {
		const q = client.select().from(table)
		return (orderBy ? q.orderBy(...orderBy) : q).all() as readonly TRow[]
	}
}

type JoinTable = SQLiteTable

/**
 * Build a join-table batch hydrator. Given a set of parent rows, fetches
 * matching join rows in a single query, groups child ids by parent id,
 * and returns each parent row enriched with a `keyName` field carrying
 * the (possibly empty) array of child ids.
 *
 * @param keyName - Literal property name (use `as const`) to surface on the result rows.
 *
 * @example
 *   const hydrate = buildHydrate(
 *     db,
 *     diaryCharacters,
 *     diaryCharacters.diaryId,
 *     diaryCharacters.charId,
 *     "charIds" as const,
 *   )
 */
export function buildHydrate<
	TParent extends { id: string },
	const K extends PropertyKey,
>(
	client: DbClient,
	joinTable: JoinTable,
	parentColumn: SQLiteColumn,
	childColumn: SQLiteColumn,
	keyName: K,
): (
	rows: readonly TParent[],
) => readonly (TParent & { readonly [P in K]: readonly string[] })[] {
	return function hydrate(rows) {
		if (rows.length === 0) return []
		const ids = rows.map((r) => r.id)
		const joinRows = client
			.select({ parent: parentColumn, child: childColumn })
			.from(joinTable)
			.where(inArray(parentColumn, ids))
			.all() as unknown as readonly {
			readonly parent: string
			readonly child: string
		}[]
		const byId = new Map<string, string[]>()
		for (const r of joinRows) {
			let list = byId.get(r.parent)
			if (list === undefined) {
				list = []
				byId.set(r.parent, list)
			}
			list.push(r.child)
		}
		return rows.map(
			(row) =>
				({
					...row,
					[keyName]: byId.get(row.id) ?? [],
				}) as TParent & { readonly [P in K]: readonly string[] },
		)
	}
}
