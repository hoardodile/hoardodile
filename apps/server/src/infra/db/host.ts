import { join } from "node:path"
import { eq } from "drizzle-orm"
import { auth, authSignIns } from "src/domain/auth/schema.ts"
import { systemPreferences } from "src/domain/prefs/schema.ts"
import { syncDevices, syncRecords } from "src/domain/sync/schema.ts"
import { type DbHandles, openDb, type SqliteDb } from "./connection.ts"

const MIGRATION_KEY = "host.libraryStateImported"

/** Host-owned records are never replaced by a library restore. */
export function openHostDatabase(root: string, source?: SqliteDb): DbHandles {
	const handles = openDb(join(root, "local", "host.sqlite"))
	try {
		handles.runMigrations()
		const db = handles.db
		const imported = db
			.select()
			.from(systemPreferences)
			.where(eq(systemPreferences.key, MIGRATION_KEY))
			.get()
		if (!imported && source) {
			db.transaction((tx) => {
				for (const row of source.select().from(auth).all())
					tx.insert(auth).values(row).onConflictDoNothing().run()
				for (const row of source.select().from(authSignIns).all())
					tx.insert(authSignIns).values(row).onConflictDoNothing().run()
				for (const row of source.select().from(syncDevices).all())
					tx.insert(syncDevices).values(row).onConflictDoNothing().run()
				for (const row of source.select().from(syncRecords).all())
					tx.insert(syncRecords).values(row).onConflictDoNothing().run()
				for (const key of [
					"sync.remindDays",
					"auth.sessionIdleTimeoutSeconds",
				]) {
					const row = source
						.select()
						.from(systemPreferences)
						.where(eq(systemPreferences.key, key))
						.get()
					if (row)
						tx.insert(systemPreferences).values(row).onConflictDoNothing().run()
				}
				tx.insert(systemPreferences)
					.values({
						key: MIGRATION_KEY,
						value: "true",
						scope: "sync",
						updatedAt: Date.now(),
					})
					.run()
			})
		}
		return handles
	} catch (error) {
		handles.close()
		throw error
	}
}
