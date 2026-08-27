import { z } from "zod"
import { id, timestamp } from "./primitives.ts"

/**
 * Reminder-interval presets (in days) offered by the device-record
 * settings UI.
 */
export const SYNC_REMIND_DAYS_OPTIONS = [3, 7, 14, 30] as const

export const DEFAULT_SYNC_REMIND_DAYS = 7

/** Display-name length for a record-tracking device. */
export const MAX_SYNC_DEVICE_NAME_LENGTH = 64
/** Notes length for a record-tracking device. */
export const MAX_SYNC_DEVICE_NOTES_LENGTH = 300

/**
 * One record-tracking target: a device the user keeps in sync with their
 * library. Each device keeps its own snapshot history and reminder
 * state. The feature only stores records — it never talks to any sync
 * software.
 */
export const syncDevice = z.object({
	id,
	/** Device display name, trimmed, non-empty. */
	name: z.string().trim().min(1).max(MAX_SYNC_DEVICE_NAME_LENGTH),
	/** Free-form notes about the device; empty string when absent. */
	notes: z.string().trim().max(MAX_SYNC_DEVICE_NOTES_LENGTH),
	createdAt: timestamp,
	updatedAt: timestamp,
})

export type SyncDevice = z.infer<typeof syncDevice>

export const syncDeviceCreateInput = z.object({
	name: syncDevice.shape.name,
	notes: z.string().trim().max(MAX_SYNC_DEVICE_NOTES_LENGTH).optional(),
})

export type SyncDeviceCreateInput = z.infer<typeof syncDeviceCreateInput>

export const syncDeviceUpdateInput = z.object({
	id,
	name: z.string().trim().min(1).max(MAX_SYNC_DEVICE_NAME_LENGTH).optional(),
	notes: z.string().trim().max(MAX_SYNC_DEVICE_NOTES_LENGTH).optional(),
})

export type SyncDeviceUpdateInput = z.infer<typeof syncDeviceUpdateInput>

/**
 * The observed state of the library, shared by a recorded snapshot
 * ({@link syncRecord}) and the live state ({@link syncLiveState}). The
 * shapes must stay identical so the UI can diff "now" against a
 * device's baseline snapshot.
 */
const syncObservedState = {
	/** Live (non-deleted) resource count. */
	resourceCount: z.number().int().nonnegative(),
	/** Live (non-deleted) character count. */
	characterCount: z.number().int().nonnegative(),
	/** Live (non-deleted) document count (folders excluded). */
	documentCount: z.number().int().nonnegative(),
	/** Live (non-deleted) folder count in the document tree. */
	folderCount: z.number().int().nonnegative(),
	/** Live (non-deleted) comment count. */
	commentCount: z.number().int().nonnegative(),
	/** Tag count. */
	tagCount: z.number().int().nonnegative(),
	/** Collection count. */
	collectionCount: z.number().int().nonnegative(),
	/** Trashed (soft-deleted) resource count. */
	trashCount: z.number().int().nonnegative(),
	/** Total bytes the storage root occupies. */
	storageBytes: z.number().int().nonnegative(),
	/** Total bytes of live resource files. */
	resourceBytes: z.number().int().nonnegative(),
}

/**
 * One automatically captured state snapshot for a device — the baseline
 * the UI diffs the live library state against. All values are captured
 * server-side at record time, matching {@link syncLiveState} field for
 * field. `recordedAt` is the moment the reminder counts from; `createdAt`
 * is when the row was written.
 */
export const syncRecord = z.object({
	id,
	/** The device this snapshot was recorded for. */
	deviceId: id,
	recordedAt: timestamp,
	...syncObservedState,
	createdAt: timestamp,
})

export type SyncRecord = z.infer<typeof syncRecord>

export const syncRecordCreateInput = z.object({
	deviceId: id,
})

export type SyncRecordCreateInput = z.infer<typeof syncRecordCreateInput>

/**
 * The live library state right now, computed by the server on demand
 * with the same fields as a recorded snapshot.
 */
export const syncLiveState = z.object(syncObservedState)

export type SyncLiveState = z.infer<typeof syncLiveState>

/**
 * Reminder state for one device, computed by the server. `due` is `true`
 * when the device never had a record or its newest record is older than
 * the reminder interval.
 */
export const syncDeviceSummary = z.object({
	device: syncDevice,
	/** `recordedAt` of the most recent snapshot; absent when none exist. */
	lastRecordedAt: timestamp.optional(),
	/** Whole days since the last record; absent when none exist. */
	elapsedDays: z.number().int().nonnegative().optional(),
	/** Whether a record reminder should be shown for this device. */
	due: z.boolean(),
	/**
	 * The baseline snapshot; the UI diffs the live state
	 * ({@link syncLiveState}) against it. Absent when the device never
	 * recorded — every field then reads as "first sync".
	 */
	latestRecord: syncRecord.optional(),
})

export type SyncDeviceSummary = z.infer<typeof syncDeviceSummary>

/**
 * Reminder state for the whole device-record feature. A device-less
 * summary (empty `devices`) is the permanent "not configured" state.
 */
export const syncSummary = z.object({
	/** Reminder interval in days. */
	remindDays: z.number().int().positive(),
	/** Per-device reminder state, in creation order. */
	devices: z.array(syncDeviceSummary),
})

export type SyncSummary = z.infer<typeof syncSummary>
