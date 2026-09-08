import { existsSync } from "node:fs"
import { join } from "node:path"
import { type DbHandles, openDb } from "./connection.ts"

/** Host-owned records are never replaced by a library restore. */
export function openHostDatabase(root: string): DbHandles {
	const path = join(root, "local", "host.sqlite")
	if (!existsSync(path) && existsSync(join(root, "app.sqlite"))) {
		// The server boot path migrates an old-layout library before opening the
		// host DB (runStorageMigrations). Reaching this means a caller opened the
		// host DB without that migration — refuse rather than operate on a mixed
		// layout.
		throw new Error(
			"This library uses an unsupported storage layout. Start the app to migrate it, or use a new storage root.",
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
