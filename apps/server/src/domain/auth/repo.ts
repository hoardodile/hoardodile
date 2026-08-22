import { eq } from "drizzle-orm"
import type { SqliteDb } from "src/infra/db/connection.ts"
import { schema } from "src/infra/db/connection.ts"

/**
 * The single-user auth row as stored in the `auth` table. The singleton
 * row (primary key 1) holds the argon2id hash of the admin password.
 */
export type StoredAuthRow = {
	readonly hash: string
	readonly updatedAt: number
}

/**
 * Read the stored auth row, or `undefined` when the server is
 * unconfigured (no admin password has ever been set).
 */
export function getAuthRow(db: SqliteDb): StoredAuthRow | undefined {
	const row = db
		.select({
			hash: schema.auth.passwordHash,
			updatedAt: schema.auth.updatedAt,
		})
		.from(schema.auth)
		.where(eq(schema.auth.singleton, 1))
		.get()
	if (row === undefined) return undefined
	return { hash: row.hash, updatedAt: row.updatedAt }
}

/**
 * Upsert the auth row. The single write path for every password change
 * (first-run setup, change password, CLI reset seeds, restore transplant).
 */
export function setAuthRow(db: SqliteDb, row: StoredAuthRow): void {
	db.insert(schema.auth)
		.values({ singleton: 1, passwordHash: row.hash, updatedAt: row.updatedAt })
		.onConflictDoUpdate({
			target: schema.auth.singleton,
			set: { passwordHash: row.hash, updatedAt: row.updatedAt },
		})
		.run()
}

/**
 * Remove the auth row, returning the server to the unconfigured state so
 * the web setup flow can claim it again.
 */
export function deleteAuthRow(db: SqliteDb): void {
	db.delete(schema.auth).where(eq(schema.auth.singleton, 1)).run()
}
