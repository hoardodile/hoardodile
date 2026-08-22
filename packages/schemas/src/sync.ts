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
 * One automatically captured state snapshot for a device. All values are
 * captured server-side at record time — entity counts exclude deleted
 * rows, documents exclude folders, `trashCount` counts trashed
 * resources, `storageBytes` is the total size of the storage root and
 * `resourceBytes` the live resource files alone. `recordedAt` is the
 * moment the reminder counts from; `createdAt` is when the row was
 * written.
 */
export const syncRecord = z.object({
	id,
	/** The device this snapshot was recorded for. */
	deviceId: id,
	recordedAt: timestamp,
	/** Live resource count at record time. */
	resourceCount: z.number().int().nonnegative(),
	/** Live character count at record time. */
	characterCount: z.number().int().nonnegative(),
	/** Live document count (folders excluded) at record time. */
	documentCount: z.number().int().nonnegative(),
	/** Live comment count at record time. */
	commentCount: z.number().int().nonnegative(),
	/** Tag count at record time. */
	tagCount: z.number().int().nonnegative(),
	/** Trashed (soft-deleted) resource count at record time. */
	trashCount: z.number().int().nonnegative(),
	/** Total bytes occupied by the storage root at record time. */
	storageBytes: z.number().int().nonnegative(),
	/** Total bytes of live resource files at record time. */
	resourceBytes: z.number().int().nonnegative(),
	createdAt: timestamp,
})

export type SyncRecord = z.infer<typeof syncRecord>

export const syncRecordCreateInput = z.object({
	deviceId: id,
})

export type SyncRecordCreateInput = z.infer<typeof syncRecordCreateInput>

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
	/** The most recent snapshot; absent when the device never recorded. */
	latestRecord: syncRecord.optional(),
	/**
	 * The snapshot before the latest one, kept so the card can show what
	 * changed since the last record; absent when only one exists.
	 */
	previousRecord: syncRecord.optional(),
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
