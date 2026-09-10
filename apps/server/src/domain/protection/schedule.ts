import { z } from "zod"

/**
 * How often automatic backups may run. The scheduler polls for library
 * changes frequently, but only turns a change into a recovery point once
 * the interval has elapsed since the last automatic (or, when none exists
 * yet, any) backup — so an idle-edit session never grows the recovery
 * point list every few minutes.
 */
export const autoBackupIntervalHours = z
	.number()
	.int()
	.min(1)
	.max(168)
	.default(24)

export type AutoBackupDueInput = {
	/** The library changed since the last automatic backup. */
	changed: boolean
	lastAutoBackupAt: number | null
	/** Any completed backup (manual or automatic) — the baseline before the first automatic run. */
	lastBackupAt: number | null
	intervalHours: number
	now?: number
}

/**
 * Automatic backups run at most once per interval, and only when the
 * library actually changed. `lastBackupAt` seeds the baseline so a fresh
 * setup does not immediately create a redundant automatic point next to
 * the first manual one.
 */
export function autoBackupDue(input: AutoBackupDueInput): boolean {
	if (!input.changed) return false
	const reference = input.lastAutoBackupAt ?? input.lastBackupAt
	if (reference === null) return true
	return (
		(input.now ?? Date.now()) - reference >= input.intervalHours * 3_600_000
	)
}
