import { eq } from "drizzle-orm"
import type { SqliteDb } from "src/infra/db/connection.ts"
import { schema } from "src/infra/db/connection.ts"

/**
 * The single-user auth row as stored in the `auth` table. The singleton
 * row (primary key 1) holds the argon2id hash of the admin password plus
 * the last strength assessment.
 */
export type StoredAuthRow = {
	readonly hash: string
	readonly updatedAt: number
	readonly weakPassword: boolean
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
			weakPassword: schema.auth.weakPassword,
		})
		.from(schema.auth)
		.where(eq(schema.auth.singleton, 1))
		.get()
	if (row === undefined) return undefined
	return {
		hash: row.hash,
		updatedAt: row.updatedAt,
		weakPassword: row.weakPassword === 1,
	}
}

/**
 * Upsert the auth row. The single write path for every password change
 * (first-run setup, change password, CLI reset seeds, restore transplant).
 */
export function setAuthRow(db: SqliteDb, row: StoredAuthRow): void {
	db.insert(schema.auth)
		.values({
			singleton: 1,
			passwordHash: row.hash,
			updatedAt: row.updatedAt,
			weakPassword: row.weakPassword ? 1 : 0,
		})
		.onConflictDoUpdate({
			target: schema.auth.singleton,
			set: {
				passwordHash: row.hash,
				updatedAt: row.updatedAt,
				weakPassword: row.weakPassword ? 1 : 0,
			},
		})
		.run()
}

/**
 * Update only the strength assessment. Used after a successful login,
 * which re-evaluates the (cleartext) password without re-hashing it.
 */
export function setPasswordWeakness(db: SqliteDb, weak: boolean): void {
	db.update(schema.auth)
		.set({ weakPassword: weak ? 1 : 0 })
		.where(eq(schema.auth.singleton, 1))
		.run()
}

/**
 * Remove the auth row, returning the server to the unconfigured state so
 * the web setup flow can claim it again.
 */
export function deleteAuthRow(db: SqliteDb): void {
	db.delete(schema.auth).where(eq(schema.auth.singleton, 1)).run()
}
