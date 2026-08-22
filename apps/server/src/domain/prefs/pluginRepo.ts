import { and, eq, inArray } from "drizzle-orm"
import type { DbClient } from "src/infra/db/connection.ts"
import { pluginPreferences } from "./schema.ts"

export type PluginPrefRow = typeof pluginPreferences.$inferSelect

export type PluginPrefRepository = {
	get(pluginId: string, key: string): PluginPrefRow | undefined
	getMany(pluginId: string, keys: readonly string[]): readonly PluginPrefRow[]
	listByPlugin(pluginId: string): readonly PluginPrefRow[]
	upsert(pluginId: string, key: string, value: string, ts: number): void
	remove(pluginId: string, key: string): void
	removeAllByPlugin(pluginId: string): void
	removeAll(): void
}

/**
 * Pure Drizzle query layer for {@link pluginPreferences}.
 */
export function buildPluginPrefRepository(
	client: DbClient,
): PluginPrefRepository {
	function get(pluginId: string, key: string): PluginPrefRow | undefined {
		const row = client
			.select()
			.from(pluginPreferences)
			.where(
				and(
					eq(pluginPreferences.pluginId, pluginId),
					eq(pluginPreferences.key, key),
				),
			)
			.get()
		return row ?? undefined
	}

	function getMany(
		pluginId: string,
		keys: readonly string[],
	): readonly PluginPrefRow[] {
		if (keys.length === 0) return []
		return client
			.select()
			.from(pluginPreferences)
			.where(
				and(
					eq(pluginPreferences.pluginId, pluginId),
					inArray(pluginPreferences.key, [...keys]),
				),
			)
			.all()
	}

	function listByPlugin(pluginId: string): readonly PluginPrefRow[] {
		return client
			.select()
			.from(pluginPreferences)
			.where(eq(pluginPreferences.pluginId, pluginId))
			.all()
	}

	function upsert(
		pluginId: string,
		key: string,
		value: string,
		ts: number,
	): void {
		client
			.insert(pluginPreferences)
			.values({ pluginId, key, value, updatedAt: ts })
			.onConflictDoUpdate({
				target: [pluginPreferences.pluginId, pluginPreferences.key],
				set: { value, updatedAt: ts },
			})
			.run()
	}

	function remove(pluginId: string, key: string): void {
		client
			.delete(pluginPreferences)
			.where(
				and(
					eq(pluginPreferences.pluginId, pluginId),
					eq(pluginPreferences.key, key),
				),
			)
			.run()
	}

	function removeAllByPlugin(pluginId: string): void {
		client
			.delete(pluginPreferences)
			.where(eq(pluginPreferences.pluginId, pluginId))
			.run()
	}

	function removeAll(): void {
		client.delete(pluginPreferences).run()
	}

	return {
		get,
		getMany,
		listByPlugin,
		upsert,
		remove,
		removeAllByPlugin,
		removeAll,
	}
}
