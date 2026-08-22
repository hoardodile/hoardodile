import type { PluginSettingsRow, PluginSettingsStore } from "@hoardodile/host"
import { eq } from "drizzle-orm"
import type { SqliteDb } from "src/infra/db/connection.ts"
import { contentPlugins } from "./schema.ts"

function toRow(row: {
	readonly id: string
	readonly manifest: string
	readonly enabled: number
	readonly priority: number
	readonly pinned: number
	readonly color: string
}): PluginSettingsRow {
	return {
		id: row.id,
		manifest: row.manifest,
		enabled: row.enabled === 1,
		priority: row.priority,
		pinned: row.pinned === 1,
		color: row.color,
	}
}

/**
 * DB-backed {@link PluginSettingsStore}: enablement, priority, pin and
 * color live in the `content_plugins` table; the host never touches the
 * database itself.
 */
export function createPluginSettingsStore(db: SqliteDb): PluginSettingsStore {
	return {
		get(id) {
			const row = db
				.select()
				.from(contentPlugins)
				.where(eq(contentPlugins.id, id))
				.get()
			return row === undefined ? undefined : toRow(row)
		},
		all() {
			return db.select().from(contentPlugins).all().map(toRow)
		},
	}
}
