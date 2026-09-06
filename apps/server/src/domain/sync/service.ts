import { DEFAULT_SYNC_REMIND_DAYS, type SyncSummary } from "@hoardodile/schemas"
import { buildAsyncPrefRepository } from "src/domain/prefs/repo.ts"
import type { SqliteDb } from "src/infra/db/connection.ts"
import { type ClockDeps, resolveClock, wrapAsync } from "src/infra/service.ts"

export const SYNC_REMIND_DAYS_PREF = "sync.remindDays"

export type SyncServiceDeps = ClockDeps & {
	readonly db: SqliteDb
	readonly hostDb?: SqliteDb
}

export type SyncService = {
	/** Store the receipt reminder interval (days) for connected devices. */
	setRemindDays(days: number): Promise<void>
	/** The reminder interval, defaulting to {@link DEFAULT_SYNC_REMIND_DAYS}. */
	summary(): Promise<SyncSummary>
}

/**
 * Sync-reminder service: the interval after which a paired device with
 * no fresh received backup shows up as due. The reminder interval is a
 * plain host pref — the transfer state itself lives in the replication
 * engine.
 */
export function createSyncService(deps: SyncServiceDeps): SyncService {
	const prefs = buildAsyncPrefRepository(deps.hostDb ?? deps.db)
	const { now } = resolveClock(deps)

	function readIntPref(key: string, fallback: number): number {
		const row = prefs.get(key)
		if (row === undefined) return fallback
		const parsed = Number(row.value)
		if (!Number.isFinite(parsed)) return fallback
		return Math.max(0, Math.floor(parsed))
	}

	return wrapAsync({
		setRemindDays: (days: number) => {
			if (!Number.isInteger(days) || days < 1 || days > 365)
				throw new Error("Reminder days must be between 1 and 365")
			prefs.upsert(SYNC_REMIND_DAYS_PREF, String(days), now())
		},
		summary: (): SyncSummary => ({
			remindDays: Math.max(
				1,
				readIntPref(SYNC_REMIND_DAYS_PREF, DEFAULT_SYNC_REMIND_DAYS),
			),
		}),
	})
}
