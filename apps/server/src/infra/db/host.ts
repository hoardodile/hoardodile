import { existsSync } from "node:fs"
import { join } from "node:path"
import { type DbHandles, openDb } from "./connection.ts"

/** Host-owned records are never replaced by a library restore. */
export function openHostDatabase(root: string): DbHandles {
	const path = join(root, "local", "host.sqlite")
	if (!existsSync(path) && existsSync(join(root, "app.sqlite"))) {
		throw new Error(
			"This library uses an unsupported storage layout. Use a new storage root; automatic host-state migration is not supported",
		)
	}
	const handles = openDb(path)
	try {
		handles.runMigrations()
		return handles
	} catch (error) {
		handles.close()
		throw error
	}
}
