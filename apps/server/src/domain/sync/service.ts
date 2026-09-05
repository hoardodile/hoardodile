import type {
	SyncDevice,
	SyncDeviceCreateInput,
	SyncDeviceSummary,
	SyncDeviceUpdateInput,
	SyncLiveState,
	SyncRecord,
	SyncRecordCreateInput,
	SyncSummary,
} from "@hoardodile/schemas"
import { DEFAULT_SYNC_REMIND_DAYS } from "@hoardodile/schemas"
import { notFound } from "@hoardodile/shared"
import type { SQL } from "drizzle-orm"
import { and, count, eq, isNotNull, isNull } from "drizzle-orm"
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core"
import { characters } from "src/domain/char/schema.ts"
import { resCollections } from "src/domain/col/schema.ts"
import { comments } from "src/domain/comment/schema.ts"
import { documents } from "src/domain/doc/schema.ts"
import { buildAsyncPrefRepository } from "src/domain/prefs/repo.ts"
import { resources } from "src/domain/res/schema.ts"
import type { StorageService } from "src/domain/storage/service.ts"
import { tags } from "src/domain/tag/schema.ts"
import type { SqliteDb } from "src/infra/db/connection.ts"
import { type ClockDeps, resolveClock, wrapAsync } from "src/infra/service.ts"
import {
	buildSyncDeviceRepository,
	buildSyncRecordRepository,
	type SyncDeviceRow,
	type SyncRecordRow,
} from "./repo.ts"

export const SYNC_REMIND_DAYS_PREF = "sync.remindDays"

const DAY_MS = 24 * 60 * 60 * 1000

export type SyncServiceDeps = ClockDeps & {
	readonly db: SqliteDb
	readonly hostDb?: SqliteDb
	/** Disk-usage accounting for the `storageBytes` snapshot value. */
	readonly storageService: StorageService
}

export type SyncService = {
	setRemindDays(days: number): Promise<void>
	/** Create a device and immediately capture its first state snapshot. */
	deviceCreate(input: SyncDeviceCreateInput): Promise<SyncDevice>
	deviceUpdate(input: SyncDeviceUpdateInput): Promise<SyncDevice>
	deviceRemove(id: string): Promise<void>
	/**
	 * Capture the current state (entity counts + storage volume) as a
	 * snapshot for a device, pruned down to this single baseline row.
	 */
	recordCreate(input: SyncRecordCreateInput): Promise<SyncRecord>
	/**
	 * The live library state right now, in the same shape as a recorded
	 * snapshot — the service's summary consumers diff it against each
	 * device's `latestRecord`.
	 */
	current(): Promise<SyncLiveState>
	summary(): Promise<SyncSummary>
}

/**
 * Device-sync service: users add target devices ("this computer",
 * "backup drive", ...) and capture an automatic snapshot of the current
 * library state per device. Creating a device records the first snapshot
 * immediately; each device keeps only its newest snapshot, which serves
 * as the baseline for the live change view (the UI diffs the live state
 * against it). The feature never touches any real sync software; the
 * interval pref is a plain number.
 */
export function createSyncService(deps: SyncServiceDeps): SyncService {
	const devices = buildSyncDeviceRepository(deps.hostDb ?? deps.db)
	const records = buildSyncRecordRepository(deps.hostDb ?? deps.db)
	const prefs = buildAsyncPrefRepository(deps.hostDb ?? deps.db)
	const { now, newId } = resolveClock(deps)

	function readIntPref(key: string, fallback: number): number {
		const row = prefs.get(key)
		if (row === undefined) return fallback
		const parsed = Number(row.value)
		if (!Number.isFinite(parsed)) return fallback
		return Math.max(0, Math.floor(parsed))
	}

	async function deviceCreate(
		input: SyncDeviceCreateInput,
	): Promise<SyncDevice> {
		const ts = now()
		const id = newId()
		devices.insert({
			id,
			name: input.name,
			notes: input.notes ?? "",
			createdAt: ts,
			updatedAt: ts,
		})
		await captureSnapshot(id)
		return deviceById(id)
	}

	function deviceUpdate(input: SyncDeviceUpdateInput): SyncDevice {
		const row = devices.findById(input.id)
		if (row === undefined) {
			throw notFound(
				"sync.device_not_found",
				`sync device ${input.id} not found`,
				{
					id: input.id,
				},
			)
		}
		devices.update({
			...row,
			name: input.name ?? row.name,
			notes: input.notes ?? row.notes,
			updatedAt: now(),
		})
		return deviceById(input.id)
	}

	function deviceRemove(id: string): void {
		devices.remove(id)
	}

	function deviceById(id: string): SyncDevice {
		const row = devices.findById(id)
		if (row === undefined) {
			throw notFound("sync.device_not_found", `sync device ${id} not found`, {
				id,
			})
		}
		return rowToSyncDevice(row)
	}

	async function recordCreate(
		input: SyncRecordCreateInput,
	): Promise<SyncRecord> {
		deviceById(input.deviceId)
		return captureSnapshot(input.deviceId)
	}

	/**
	 * Compute the observed state server-side: one round of entity counts
	 * plus the (60s-cached) storage overview. The same values land in a
	 * snapshot and in {@link current}; `tableCounts` uses existing
	 * deleted-at/kind indexes, so this stays cheap enough to run on the
	 * sync page's poll.
	 */
	async function liveState(): Promise<SyncLiveState> {
		const [
			resourceCount,
			characterCount,
			documentCount,
			folderCount,
			commentCount,
			tagCount,
			collectionCount,
			trashCount,
		] = tableCounts()
		const overview = await deps.storageService.getOverview()
		return {
			resourceCount,
			characterCount,
			documentCount,
			folderCount,
			commentCount,
			tagCount,
			collectionCount,
			trashCount,
			storageBytes: overview.usedBytes,
			resourceBytes: overview.resources.totalBytes,
		}
	}

	function current(): Promise<SyncLiveState> {
		return liveState()
	}

	async function captureSnapshot(deviceId: string): Promise<SyncRecord> {
		const state = await liveState()
		const ts = now()
		const id = newId()
		// Delete the previous baseline, then append the new one — a device
		// never holds more than one snapshot.
		records.keepOnly(deviceId, undefined)
		records.insert({
			id,
			deviceId,
			recordedAt: ts,
			...state,
			createdAt: ts,
		})
		const row = records.latest(deviceId)
		if (row === undefined) {
			throw notFound("sync.record_not_found", `sync record ${id} not found`, {
				id,
			})
		}
		return rowToSyncRecord(row)
	}

	function tableCounts(): [
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		number,
	] {
		return [
			tableCount(resources, isNull(resources.deletedAt)),
			tableCount(characters, isNull(characters.deletedAt)),
			tableCount(
				documents,
				and(isNull(documents.deletedAt), eq(documents.kind, "document")),
			),
			tableCount(
				documents,
				and(isNull(documents.deletedAt), eq(documents.kind, "folder")),
			),
			tableCount(comments, isNull(comments.deletedAt)),
			tableCount(tags),
			tableCount(resCollections),
			tableCount(resources, isNotNull(resources.deletedAt)),
		]
	}

	function tableCount(table: AnySQLiteTable, where?: SQL | undefined): number {
		const query = deps.db.select({ value: count() }).from(table)
		const row = (where === undefined ? query : query.where(where)).get()
		return row?.value ?? 0
	}

	function summary(): SyncSummary {
		const remindDays = Math.max(
			1,
			readIntPref(SYNC_REMIND_DAYS_PREF, DEFAULT_SYNC_REMIND_DAYS),
		)
		const ts = now()
		return {
			remindDays,
			devices: devices.list().map((row) => deviceSummary(row, remindDays, ts)),
		}
	}

	function deviceSummary(
		row: SyncDeviceRow,
		remindDays: number,
		ts: number,
	): SyncDeviceSummary {
		const latest = records.latest(row.id)
		const lastRecordedAt = latest?.recordedAt
		const elapsedMs =
			lastRecordedAt === undefined ? undefined : ts - lastRecordedAt
		const overdue =
			lastRecordedAt !== undefined &&
			elapsedMs !== undefined &&
			elapsedMs > remindDays * DAY_MS
		return {
			device: rowToSyncDevice(row),
			lastRecordedAt,
			elapsedDays:
				elapsedMs === undefined
					? undefined
					: Math.max(0, Math.floor(elapsedMs / DAY_MS)),
			due: lastRecordedAt === undefined || overdue,
			latestRecord: latest === undefined ? undefined : rowToSyncRecord(latest),
		}
	}

	return wrapAsync({
		setRemindDays: (days: number) => {
			if (!Number.isInteger(days) || days < 1 || days > 365)
				throw new Error("Reminder days must be between 1 and 365")
			prefs.upsert(SYNC_REMIND_DAYS_PREF, String(days), now())
		},
		deviceCreate,
		deviceUpdate,
		deviceRemove,
		recordCreate,
		current,
		summary,
	})
}

function rowToSyncDevice(row: SyncDeviceRow): SyncDevice {
	return {
		id: row.id,
		name: row.name,
		notes: row.notes,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}
}

function rowToSyncRecord(row: SyncRecordRow): SyncRecord {
	return {
		id: row.id,
		deviceId: row.deviceId,
		recordedAt: row.recordedAt,
		resourceCount: row.resourceCount,
		characterCount: row.characterCount,
		documentCount: row.documentCount,
		folderCount: row.folderCount,
		commentCount: row.commentCount,
		tagCount: row.tagCount,
		collectionCount: row.collectionCount,
		trashCount: row.trashCount,
		storageBytes: row.storageBytes,
		resourceBytes: row.resourceBytes,
		createdAt: row.createdAt,
	}
}
