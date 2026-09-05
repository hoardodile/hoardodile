import { mkdirSync } from "node:fs"
import { join } from "node:path"
import BetterSqlite3 from "better-sqlite3"

/** OS-backed SQLite locks release on process death, without stale PID-file deletion races. */
export function acquireStorageInstance(root: string): () => void {
	const local = join(root, "local")
	mkdirSync(local, { recursive: true })
	const db = new BetterSqlite3(join(local, "instance-lock.sqlite"), {
		timeout: 0,
	})
	try {
		db.pragma("journal_mode = DELETE")
		db.exec("CREATE TABLE IF NOT EXISTS instance_lock (id INTEGER PRIMARY KEY)")
		db.exec("BEGIN EXCLUSIVE")
	} catch (error) {
		db.close()
		if (
			error instanceof Error &&
			"code" in error &&
			(error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED")
		) {
			throw new Error("Another service already owns this storage root")
		}
		throw error
	}
	let released = false
	return () => {
		if (released) return
		released = true
		try {
			if (db.inTransaction) db.exec("ROLLBACK")
		} finally {
			db.close()
		}
	}
}
