import { and, eq } from "drizzle-orm"
import type { DbClient } from "src/infra/db/connection.ts"
import { pluginCache } from "./cacheSchema"

export type CacheRow = {
	readonly pluginId: string
	readonly resId: string
	readonly key: string
	readonly value: string
	readonly updatedAt: number
}

export type CacheRepository = {
	get(pluginId: string, resId: string, key: string): CacheRow | undefined
	listForRes(pluginId: string, resId: string): readonly CacheRow[]
	listForPlugin(pluginId: string): readonly CacheRow[]
	listByResId(resId: string): readonly CacheRow[]
	upsert(row: CacheRow): void
	remove(pluginId: string, resId: string, key: string): void
	removeAllForRes(pluginId: string, resId: string): void
	removeAllByPlugin(pluginId: string): void
	removeAll(): void
}

export function buildCacheRepository(client: DbClient): CacheRepository {
	function get(
		pluginId: string,
		resId: string,
		key: string,
	): CacheRow | undefined {
		const row = client
			.select()
			.from(pluginCache)
			.where(
				and(
					eq(pluginCache.pluginId, pluginId),
					eq(pluginCache.resId, resId),
					eq(pluginCache.key, key),
				),
			)
			.get()
		return row ?? undefined
	}

	function listForRes(pluginId: string, resId: string): readonly CacheRow[] {
		return client
			.select()
			.from(pluginCache)
			.where(
				and(eq(pluginCache.pluginId, pluginId), eq(pluginCache.resId, resId)),
			)
			.all()
	}

	function listForPlugin(pluginId: string): readonly CacheRow[] {
		return client
			.select()
			.from(pluginCache)
			.where(eq(pluginCache.pluginId, pluginId))
			.all()
	}

	function upsert(row: CacheRow): void {
		client
			.insert(pluginCache)
			.values(row)
			.onConflictDoUpdate({
				target: [pluginCache.pluginId, pluginCache.resId, pluginCache.key],
				set: {
					value: row.value,
					updatedAt: row.updatedAt,
				},
			})
			.run()
	}

	function remove(pluginId: string, resId: string, key: string): void {
		client
			.delete(pluginCache)
			.where(
				and(
					eq(pluginCache.pluginId, pluginId),
					eq(pluginCache.resId, resId),
					eq(pluginCache.key, key),
				),
			)
			.run()
	}

	function listByResId(resId: string): readonly CacheRow[] {
		return client
			.select()
			.from(pluginCache)
			.where(eq(pluginCache.resId, resId))
			.all()
	}

	function removeAllForRes(pluginId: string, resId: string): void {
		client
			.delete(pluginCache)
			.where(
				and(eq(pluginCache.pluginId, pluginId), eq(pluginCache.resId, resId)),
			)
			.run()
	}

	function removeAllByPlugin(pluginId: string): void {
		client.delete(pluginCache).where(eq(pluginCache.pluginId, pluginId)).run()
	}

	function removeAll(): void {
		client.delete(pluginCache).run()
	}

	return {
		get,
		listForRes,
		listForPlugin,
		listByResId,
		upsert,
		remove,
		removeAllForRes,
		removeAllByPlugin,
		removeAll,
	}
}
