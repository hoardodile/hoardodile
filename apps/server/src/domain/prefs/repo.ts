import { and, eq, inArray } from "drizzle-orm"
import type { DbClient } from "src/infra/db/connection.ts"
import { systemPreferences } from "./schema.ts"

export type SystemPrefRow = typeof systemPreferences.$inferSelect
export type PrefScope = "sync" | "async"

export type SystemPrefRepository = {
	get(key: string): SystemPrefRow | undefined
	getMany(keys: readonly string[]): readonly SystemPrefRow[]
	listAll(): readonly SystemPrefRow[]
	upsert(key: string, value: string, ts: number): void
	remove(key: string): void
	removeAll(): void
}

export type AsyncPrefRepository = SystemPrefRepository

/**
 * Pure Drizzle query layer for {@link systemPreferences}.
 *
 * Uses SQLite `INSERT ... ON CONFLICT DO UPDATE` so callers do not
 * have to branch on existence; both fresh writes and overwrites take
 * a single statement.
 *
 * @param client - Drizzle DB client (main connection or transaction).
 * @param scope - `"sync"` for preferences mirrored in the local prefSync
 *   store; `"async"` for preferences fetched on demand by the client.
 */
export function buildSystemPrefRepository(
	client: DbClient,
	scope: PrefScope = "sync",
): SystemPrefRepository {
	function get(key: string): SystemPrefRow | undefined {
		const row = client
			.select()
			.from(systemPreferences)
			.where(eq(systemPreferences.key, key))
			.get()
		return row ?? undefined
	}

	function getMany(keys: readonly string[]): readonly SystemPrefRow[] {
		if (keys.length === 0) return []
		return client
			.select()
			.from(systemPreferences)
			.where(inArray(systemPreferences.key, [...keys]))
			.all()
	}

	function listAll(): readonly SystemPrefRow[] {
		return client
			.select()
			.from(systemPreferences)
			.where(eq(systemPreferences.scope, scope))
			.all()
	}

	function upsert(key: string, value: string, ts: number): void {
		client
			.insert(systemPreferences)
			.values({ key, scope, value, updatedAt: ts })
			.onConflictDoUpdate({
				target: systemPreferences.key,
				set: { scope, value, updatedAt: ts },
			})
			.run()
	}

	function remove(key: string): void {
		client
			.delete(systemPreferences)
			.where(
				and(eq(systemPreferences.key, key), eq(systemPreferences.scope, scope)),
			)
			.run()
	}

	function removeAll(): void {
		client
			.delete(systemPreferences)
			.where(eq(systemPreferences.scope, scope))
			.run()
	}

	return { get, getMany, listAll, upsert, remove, removeAll }
}

/** Repository for async-scope preferences; same shape, isolated by `scope`. */
export function buildAsyncPrefRepository(
	client: DbClient,
): AsyncPrefRepository {
	return buildSystemPrefRepository(client, "async")
}
