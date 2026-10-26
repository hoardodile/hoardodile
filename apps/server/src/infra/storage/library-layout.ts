import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import BetterSqlite3 from "better-sqlite3"
import { z } from "zod"
import { readStorageFormat } from "./storage-format.ts"

export const HOST_TABLES = ["auth", "auth_sign_ins"] as const
// These preferences belong to the host even in the legacy combined DB.
export const HOST_PREFS = [
	"sync.remindDays",
	"auth.sessionIdleTimeoutSeconds",
] as const
export const LEGACY_BACKUP_FOLDERS = ["db-backups", "snapshots"] as const

const migrationState = z.object({
	format: z.literal(1),
	phase: z.enum(["preparing", "prepared", "complete"]),
})

/** Missing local state alone is not evidence of a pre-retrofit library. */
export function isOldLayoutLibrary(root: string): boolean {
	const database = join(root, "app.sqlite")
	if (
		!existsSync(database) ||
		readStorageFormat(root) > 0 ||
		existsSync(join(root, "local", "host.sqlite"))
	)
		return false

	const state = join(root, "local", "backup-layout-migration", "state.json")
	if (existsSync(state)) {
		const { phase } = migrationState.parse(
			JSON.parse(readFileSync(state, "utf8")),
		)
		if (phase !== "complete") return true
	}
	if (
		LEGACY_BACKUP_FOLDERS.some((name) =>
			existsSync(join(root, "versions", "1", name)),
		)
	)
		return true

	// Opening read-only must fail visibly on an unreadable database; never
	// turn a failed inspection into permission to stamp a library as current.
	const db = new BetterSqlite3(database, {
		readonly: true,
		fileMustExist: true,
	})
	try {
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.pluck()
			.all()
		for (const table of HOST_TABLES) {
			if (
				tables.includes(table) &&
				db.prepare(`SELECT 1 FROM "${table}" LIMIT 1`).get()
			)
				return true
		}
		return (
			tables.includes("system_preferences") &&
			Boolean(
				db
					.prepare(
						"SELECT 1 FROM system_preferences WHERE key IN (?, ?) LIMIT 1",
					)
					.get(...HOST_PREFS),
			)
		)
	} finally {
		db.close()
	}
}
