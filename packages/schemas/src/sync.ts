import { z } from "zod"

/**
 * Reminder-interval presets (in days) offered by the backup-sync
 * devices settings UI.
 */
export const SYNC_REMIND_DAYS_OPTIONS = [3, 7, 14, 30] as const

export const DEFAULT_SYNC_REMIND_DAYS = 7

/**
 * Reminder state for the backup-sync feature: the interval a connected
 * device's last received backup must not exceed before a red dot shows
 * up in the app chrome.
 */
export const syncSummary = z.object({
	/** Reminder interval in days. */
	remindDays: z.number().int().positive(),
})

export type SyncSummary = z.infer<typeof syncSummary>
