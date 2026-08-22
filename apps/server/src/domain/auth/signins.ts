import { desc, lt } from "drizzle-orm"
import type { SqliteDb } from "src/infra/db/connection.ts"
import { schema } from "src/infra/db/connection.ts"
import type { ConnectionOrigin } from "./device.ts"

/** Retention window for sign-in events. */
const SIGNIN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

export type SignInEvent = {
	/** Session id issued by the login. */
	readonly id: string
	readonly ip: string
	readonly origin: ConnectionOrigin
	readonly deviceLabel: string
	readonly recordedAt: number
}

export type SignInRecord = SignInEvent

/**
 * Record a successful login and prune rows older than the retention
 * window. Append-order writes; the newest rows are what the UI shows.
 */
export function recordSignIn(db: SqliteDb, event: SignInEvent): void {
	db.insert(schema.authSignIns)
		.values({
			id: event.id,
			ip: event.ip,
			origin: event.origin,
			deviceLabel: event.deviceLabel,
			recordedAt: event.recordedAt,
		})
		.onConflictDoNothing()
		.run()
	db.delete(schema.authSignIns)
		.where(
			lt(schema.authSignIns.recordedAt, event.recordedAt - SIGNIN_RETENTION_MS),
		)
		.run()
}

/** Newest sign-ins first. */
export function listSignIns(db: SqliteDb, limit = 20): SignInRecord[] {
	const rows = db
		.select()
		.from(schema.authSignIns)
		.orderBy(desc(schema.authSignIns.recordedAt))
		.limit(limit)
		.all()
	return rows.map((row) => ({
		id: row.id,
		ip: row.ip,
		origin: row.origin,
		deviceLabel: row.deviceLabel,
		recordedAt: row.recordedAt,
	}))
}
