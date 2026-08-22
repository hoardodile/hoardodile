import { and, asc, desc, eq, ne } from "drizzle-orm"
import type { DbClient } from "src/infra/db/connection.ts"
import { syncDevices, syncRecords } from "./schema.ts"

export type SyncDeviceRow = typeof syncDevices.$inferSelect
export type SyncRecordRow = typeof syncRecords.$inferSelect

/**
 * Pure Drizzle query layer for the sync-devices module. No domain rules;
 * the service layer owns the reminder semantics.
 */
export type SyncDeviceRepository = {
	insert(row: SyncDeviceRow): void
	findById(id: string): SyncDeviceRow | undefined
	/** All devices in creation order. */
	list(): SyncDeviceRow[]
	update(row: SyncDeviceRow): void
	remove(id: string): void
}

/**
 * Pure Drizzle query layer for the sync-records module. No domain rules;
 * the service layer owns the snapshot/reminder semantics and prunes the
 * history to at most two rows per device.
 */
export type SyncRecordRepository = {
	insert(row: SyncRecordRow): void
	/** Most recent record by `recordedAt` for one device, or `undefined`. */
	latest(deviceId: string): SyncRecordRow | undefined
	/**
	 * Most recent record by `recordedAt` for one device, excluding the
	 * given record; `undefined` when no other record exists.
	 */
	previous(deviceId: string, excludeId: string): SyncRecordRow | undefined
	/** Delete every record of a device except the one to keep. */
	keepOnly(deviceId: string, keepId: string | undefined): void
}

export function buildSyncDeviceRepository(
	client: DbClient,
): SyncDeviceRepository {
	function insert(row: SyncDeviceRow): void {
		client.insert(syncDevices).values(row).run()
	}

	function findById(id: string): SyncDeviceRow | undefined {
		return (
			client.select().from(syncDevices).where(eq(syncDevices.id, id)).get() ??
			undefined
		)
	}

	function list(): SyncDeviceRow[] {
		return client
			.select()
			.from(syncDevices)
			.orderBy(asc(syncDevices.createdAt), asc(syncDevices.id))
			.all()
	}

	function update(row: SyncDeviceRow): void {
		client
			.update(syncDevices)
			.set({
				name: row.name,
				notes: row.notes,
				updatedAt: row.updatedAt,
			})
			.where(eq(syncDevices.id, row.id))
			.run()
	}

	function remove(id: string): void {
		client.delete(syncDevices).where(eq(syncDevices.id, id)).run()
	}

	return { insert, findById, list, update, remove }
}

export function buildSyncRecordRepository(
	client: DbClient,
): SyncRecordRepository {
	function insert(row: SyncRecordRow): void {
		client.insert(syncRecords).values(row).run()
	}

	function latest(deviceId: string): SyncRecordRow | undefined {
		return (
			client
				.select()
				.from(syncRecords)
				.where(eq(syncRecords.deviceId, deviceId))
				.orderBy(desc(syncRecords.recordedAt), desc(syncRecords.createdAt))
				.limit(1)
				.get() ?? undefined
		)
	}

	function previous(
		deviceId: string,
		excludeId: string,
	): SyncRecordRow | undefined {
		return (
			client
				.select()
				.from(syncRecords)
				.where(
					and(
						eq(syncRecords.deviceId, deviceId),
						ne(syncRecords.id, excludeId),
					),
				)
				.orderBy(desc(syncRecords.recordedAt), desc(syncRecords.createdAt))
				.limit(1)
				.get() ?? undefined
		)
	}

	function keepOnly(deviceId: string, keepId: string | undefined): void {
		if (keepId === undefined) {
			client.delete(syncRecords).where(eq(syncRecords.deviceId, deviceId)).run()
			return
		}
		client
			.delete(syncRecords)
			.where(
				and(eq(syncRecords.deviceId, deviceId), ne(syncRecords.id, keepId)),
			)
			.run()
	}

	return { insert, latest, previous, keepOnly }
}
