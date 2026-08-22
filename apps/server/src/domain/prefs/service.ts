import type { SqliteDb } from "src/infra/db/connection.ts"
import type { ClockDeps } from "src/infra/service.ts"
import { buildCacheRepository, type CacheRepository } from "./cacheRepo.ts"
import {
	buildPluginPrefRepository,
	type PluginPrefRepository,
} from "./pluginRepo.ts"
import {
	type AsyncPrefRepository,
	buildAsyncPrefRepository,
	buildSystemPrefRepository,
	type SystemPrefRepository,
} from "./repo.ts"

export type PrefServiceDeps = ClockDeps & {
	readonly db: SqliteDb
}

export type SystemPrefEntry = {
	readonly key: string
	readonly value: string
	readonly updatedAt: number
}

export type PluginPrefEntry = {
	readonly pluginId: string
	readonly key: string
	readonly value: string
	readonly updatedAt: number
}

export type CacheEntry = {
	readonly pluginId: string
	readonly resId: string
	readonly key: string
	readonly value: string
	readonly updatedAt: number
}

export type SystemPrefService = {
	get(key: string): SystemPrefEntry | undefined
	getMany(keys: readonly string[]): readonly SystemPrefEntry[]
	listAll(): readonly SystemPrefEntry[]
	set(key: string, value: string): SystemPrefEntry
	remove(key: string): void
	removeAll(): void
}

export type AsyncPrefService = {
	get(key: string): SystemPrefEntry | undefined
	getMany(keys: readonly string[]): readonly SystemPrefEntry[]
	set(key: string, value: string): SystemPrefEntry
	remove(key: string): void
	removeAll(): void
}

export type PluginPrefService = {
	get(pluginId: string, key: string): PluginPrefEntry | undefined
	getMany(pluginId: string, keys: readonly string[]): readonly PluginPrefEntry[]
	listByPlugin(pluginId: string): readonly PluginPrefEntry[]
	set(pluginId: string, key: string, value: string): PluginPrefEntry
	remove(pluginId: string, key: string): void
	removeAllByPlugin(pluginId: string): void
	removeAll(): void
}

export type CacheService = {
	get(pluginId: string, resId: string, key: string): CacheEntry | undefined
	listForRes(pluginId: string, resId: string): readonly CacheEntry[]
	listForPlugin(pluginId: string): readonly CacheEntry[]
	listByResId(resId: string): readonly CacheEntry[]
	set(pluginId: string, resId: string, key: string, value: string): CacheEntry
	remove(pluginId: string, resId: string, key: string): void
	removeAllForRes(pluginId: string, resId: string): void
	removeAllByPlugin(pluginId: string): void
	removeAll(): void
}

export function createSystemPrefService(
	deps: PrefServiceDeps,
): SystemPrefService {
	const { db, now = Date.now } = deps
	const repo: SystemPrefRepository = buildSystemPrefRepository(db)

	function toEntry(row: {
		readonly key: string
		readonly value: string
		readonly updatedAt: number
	}): SystemPrefEntry {
		return { key: row.key, value: row.value, updatedAt: row.updatedAt }
	}

	function get(key: string): SystemPrefEntry | undefined {
		const row = repo.get(key)
		return row === undefined ? undefined : toEntry(row)
	}

	function getMany(keys: readonly string[]): readonly SystemPrefEntry[] {
		return repo.getMany(keys).map(toEntry)
	}

	function listAll(): readonly SystemPrefEntry[] {
		return repo.listAll().map(toEntry)
	}

	function set(key: string, value: string): SystemPrefEntry {
		const ts = now()
		repo.upsert(key, value, ts)
		return { key, value, updatedAt: ts }
	}

	function remove(key: string): void {
		repo.remove(key)
	}

	function removeAll(): void {
		repo.removeAll()
	}

	return { get, getMany, listAll, set, remove, removeAll }
}

export function createAsyncPrefService(
	deps: PrefServiceDeps,
): AsyncPrefService {
	const { db, now = Date.now } = deps
	const repo: AsyncPrefRepository = buildAsyncPrefRepository(db)

	function toEntry(row: {
		readonly key: string
		readonly value: string
		readonly updatedAt: number
	}): SystemPrefEntry {
		return { key: row.key, value: row.value, updatedAt: row.updatedAt }
	}

	function get(key: string): SystemPrefEntry | undefined {
		const row = repo.get(key)
		return row === undefined ? undefined : toEntry(row)
	}

	function getMany(keys: readonly string[]): readonly SystemPrefEntry[] {
		return repo.getMany(keys).map(toEntry)
	}

	function set(key: string, value: string): SystemPrefEntry {
		const ts = now()
		repo.upsert(key, value, ts)
		return { key, value, updatedAt: ts }
	}

	function remove(key: string): void {
		repo.remove(key)
	}

	function removeAll(): void {
		repo.removeAll()
	}

	return { get, getMany, set, remove, removeAll }
}

export function createPluginPrefService(
	deps: PrefServiceDeps,
): PluginPrefService {
	const { db, now = Date.now } = deps
	const repo: PluginPrefRepository = buildPluginPrefRepository(db)

	function toEntry(row: {
		readonly pluginId: string
		readonly key: string
		readonly value: string
		readonly updatedAt: number
	}): PluginPrefEntry {
		return {
			pluginId: row.pluginId,
			key: row.key,
			value: row.value,
			updatedAt: row.updatedAt,
		}
	}

	function get(pluginId: string, key: string): PluginPrefEntry | undefined {
		const row = repo.get(pluginId, key)
		return row === undefined ? undefined : toEntry(row)
	}

	function getMany(
		pluginId: string,
		keys: readonly string[],
	): readonly PluginPrefEntry[] {
		return repo.getMany(pluginId, keys).map(toEntry)
	}

	function listByPlugin(pluginId: string): readonly PluginPrefEntry[] {
		return repo.listByPlugin(pluginId).map(toEntry)
	}

	function set(pluginId: string, key: string, value: string): PluginPrefEntry {
		const ts = now()
		repo.upsert(pluginId, key, value, ts)
		return { pluginId, key, value, updatedAt: ts }
	}

	function remove(pluginId: string, key: string): void {
		repo.remove(pluginId, key)
	}

	function removeAllByPlugin(pluginId: string): void {
		repo.removeAllByPlugin(pluginId)
	}

	function removeAll(): void {
		repo.removeAll()
	}

	return {
		get,
		getMany,
		listByPlugin,
		set,
		remove,
		removeAllByPlugin,
		removeAll,
	}
}

export function createCacheService(deps: PrefServiceDeps): CacheService {
	const { db, now = Date.now } = deps
	const repo: CacheRepository = buildCacheRepository(db)

	function toEntry(row: {
		readonly pluginId: string
		readonly resId: string
		readonly key: string
		readonly value: string
		readonly updatedAt: number
	}): CacheEntry {
		return {
			pluginId: row.pluginId,
			resId: row.resId,
			key: row.key,
			value: row.value,
			updatedAt: row.updatedAt,
		}
	}

	function get(
		pluginId: string,
		resId: string,
		key: string,
	): CacheEntry | undefined {
		const row = repo.get(pluginId, resId, key)
		return row === undefined ? undefined : toEntry(row)
	}

	function listForRes(pluginId: string, resId: string): readonly CacheEntry[] {
		return repo.listForRes(pluginId, resId).map(toEntry)
	}

	function listForPlugin(pluginId: string): readonly CacheEntry[] {
		return repo.listForPlugin(pluginId).map(toEntry)
	}

	function listByResId(resId: string): readonly CacheEntry[] {
		return repo.listByResId(resId).map(toEntry)
	}

	function set(
		pluginId: string,
		resId: string,
		key: string,
		value: string,
	): CacheEntry {
		const ts = now()
		repo.upsert({ pluginId, resId, key, value, updatedAt: ts })
		return { pluginId, resId, key, value, updatedAt: ts }
	}

	function remove(pluginId: string, resId: string, key: string): void {
		repo.remove(pluginId, resId, key)
	}

	function removeAllForRes(pluginId: string, resId: string): void {
		repo.removeAllForRes(pluginId, resId)
	}

	function removeAllByPlugin(pluginId: string): void {
		repo.removeAllByPlugin(pluginId)
	}

	function removeAll(): void {
		repo.removeAll()
	}

	return {
		get,
		listForRes,
		listForPlugin,
		listByResId,
		set,
		remove,
		removeAllForRes,
		removeAllByPlugin,
		removeAll,
	}
}
