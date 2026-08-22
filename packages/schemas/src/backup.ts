import { z } from "zod"
import { timestamp } from "./primitives.ts"
import {
	MAX_BACKUP_NAME_LENGTH,
	MAX_HISTORY_NOTE_LENGTH,
} from "./text-limits.ts"

/**
 * Single-file SQLite snapshot produced by the in-app "Backup now" action.
 * The `name` is a filesystem-safe filename under `{storage}/versions/<v>/db-backups/`,
 * never a full path -- the server owns the directory and callers only
 * reference backups by name.
 */
export const backupSummary = z.object({
	fileName: z.string().min(1).max(MAX_BACKUP_NAME_LENGTH),
	size: z.number().int().nonnegative(),
	createdAt: timestamp,
	/**
	 * `manual` snapshots are created by the user ("Backup now"); `auto`
	 * snapshots are produced by the daily scheduler into
	 * `versions/<v>/snapshots/` and pruned to a rolling window.
	 */
	kind: z.enum(["manual", "auto"]).default("manual"),
	/**
	 * User-defined display name stored in the backup's sidecar meta.json.
	 */
	name: z.string().min(1).max(MAX_BACKUP_NAME_LENGTH).optional(),
	note: z.string().max(MAX_HISTORY_NOTE_LENGTH).optional(),
	/**
	 * Live-entity counts recorded at snapshot time (non-trashed resources /
	 * characters / documents). Absent for backups created before this field
	 * was introduced.
	 */
	counts: z
		.object({
			resources: z.number().int().nonnegative(),
			characters: z.number().int().nonnegative(),
			documents: z.number().int().nonnegative(),
		})
		.optional(),
	/**
	 * Version that was active when the backup was created. May be missing
	 * for backups created before this field was introduced.
	 */
	activeVersion: z.number().int().nonnegative().optional(),
})

export type BackupSummary = z.infer<typeof backupSummary>

/**
 * Result of requesting a restore. The server prepares the swap on disk and
 * then signals the supervisor to restart; the `willRestart` flag tells the
 * web client to expect a brief disconnection and show a waiting UI.
 */
export const restoreRequested = z.object({
	fileName: z.string().min(1).max(MAX_BACKUP_NAME_LENGTH),
	willRestart: z.boolean(),
})

export type RestoreRequested = z.infer<typeof restoreRequested>

/**
 * Runtime state of the automatic daily snapshot scheduler, surfaced so the
 * UI can tell the user the feature is on, what window it keeps, and when
 * the newest snapshot was taken.
 */
export const autoSnapshotStatus = z.object({
	/** Whether the scheduler is enabled (`AUTO_SNAPSHOT_ENABLED`). */
	enabled: z.boolean(),
	/** Rolling window size in days (`AUTO_SNAPSHOT_KEEP`). */
	keep: z.number().int().positive(),
	/** Creation time of the newest automatic snapshot, or null when none. */
	lastAt: timestamp.nullable(),
})

export type AutoSnapshotStatus = z.infer<typeof autoSnapshotStatus>
