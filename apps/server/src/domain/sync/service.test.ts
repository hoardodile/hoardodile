import { DEFAULT_SYNC_REMIND_DAYS } from "@hoardodile/schemas"
import { count } from "drizzle-orm"
import { characters } from "src/domain/char/schema.ts"
import { resCollections } from "src/domain/col/schema.ts"
import { comments } from "src/domain/comment/schema.ts"
import { documents } from "src/domain/doc/schema.ts"
import { buildAsyncPrefRepository } from "src/domain/prefs/repo.ts"
import { resources } from "src/domain/res/schema.ts"
import type { StorageService } from "src/domain/storage/service.ts"
import { syncRecords } from "src/domain/sync/schema.ts"
import { tags } from "src/domain/tag/schema.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	createSyncService,
	SYNC_REMIND_DAYS_PREF,
	type SyncService,
} from "./service.ts"

const DAY_MS = 24 * 60 * 60 * 1000

describe("sync devices service", () => {
	let dbh: DbHandles
	let nowValue: number
	let usedBytes: number
	let contentBytes: number
	let storageService: StorageService
	let svc: SyncService

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
		nowValue = 1_000_000
		usedBytes = 10_240
		contentBytes = 2_048
		storageService = {
			getOverview: vi.fn(async () => ({
				usedBytes,
				resources: { totalBytes: contentBytes },
			})),
		} as unknown as StorageService
		svc = createSyncService({
			db: dbh.db,
			storageService,
			now: () => nowValue,
		})
	})

	afterEach(() => {
		dbh.close()
	})

	function setPref(key: string, value: number) {
		buildAsyncPrefRepository(dbh.db).upsert(key, String(value), nowValue)
	}

	async function addDevice(name: string, notes = "") {
		return svc.deviceCreate({ name, notes })
	}

	async function recordCount(): Promise<number> {
		return dbh.db.select({ value: count() }).from(syncRecords).get()?.value ?? 0
	}

	test("device create persists, is listed in creation order and auto-records", async () => {
		const a = await addDevice("Laptop")
		nowValue += 60_000
		const b = await addDevice("Backup drive", "USB 4TB")
		const summary = await svc.summary()
		expect(summary.devices.map((d) => d.device.id)).toEqual([a.id, b.id])
		expect(summary.devices[0]?.device.name).toBe("Laptop")
		expect(summary.devices[1]?.device.notes).toBe("USB 4TB")
		expect(summary.devices[1]?.device.createdAt).toBe(nowValue)
		// Creating a device captures its first snapshot right away.
		expect(summary.devices[0]?.latestRecord?.deviceId).toBe(a.id)
		expect(summary.devices[0]?.latestRecord?.recordedAt).toBe(a.createdAt)
		expect(summary.devices[1]?.latestRecord?.recordedAt).toBe(nowValue)
		expect(await recordCount()).toBe(2)
		expect(storageService.getOverview).toHaveBeenCalledTimes(2)
	})

	test("device update merges name and notes and bumps updatedAt", async () => {
		const device = await addDevice("Laptop", "old notes")
		nowValue += 60_000
		const updated = await svc.deviceUpdate({
			id: device.id,
			notes: "new notes",
		})
		expect(updated.name).toBe("Laptop")
		expect(updated.notes).toBe("new notes")
		expect(updated.updatedAt).toBe(nowValue)
		const summary = await svc.summary()
		expect(summary.devices[0]?.device.notes).toBe("new notes")
	})

	test("device update throws when the device is missing", async () => {
		await expect(
			svc.deviceUpdate({ id: "missing", name: "X" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" })
	})

	test("device remove deletes the device and cascades its records", async () => {
		const device = await addDevice("Laptop")
		await svc.recordCreate({ deviceId: device.id })
		await svc.deviceRemove(device.id)
		expect((await svc.summary()).devices).toHaveLength(0)
		expect(await recordCount()).toBe(0)
	})

	test("record create requires an existing device", async () => {
		await expect(
			svc.recordCreate({ deviceId: "missing" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" })
	})

	test("record create snapshots the live entity counts, trash and storage", async () => {
		const ts = nowValue
		dbh.db
			.insert(resources)
			.values([
				{ id: "r1", name: "a", createdAt: ts, updatedAt: ts },
				{ id: "r2", name: "b", createdAt: ts, updatedAt: ts },
				{
					id: "r3",
					name: "trashed",
					createdAt: ts,
					updatedAt: ts,
					deletedAt: ts,
				},
			])
			.run()
		dbh.db
			.insert(characters)
			.values([
				{ id: "c1", name: "alice", createdAt: ts, updatedAt: ts },
				{ id: "c2", name: "bob", createdAt: ts, updatedAt: ts },
				{
					id: "c3",
					name: "trashed",
					createdAt: ts,
					updatedAt: ts,
					deletedAt: ts,
				},
			])
			.run()
		dbh.db
			.insert(documents)
			.values([
				{
					id: "d1",
					kind: "document",
					title: "notes",
					createdAt: ts,
					updatedAt: ts,
				},
				{
					id: "d2",
					kind: "folder",
					title: "folder",
					createdAt: ts,
					updatedAt: ts,
				},
				{
					id: "d3",
					kind: "document",
					title: "trashed",
					createdAt: ts,
					updatedAt: ts,
					deletedAt: ts,
				},
			])
			.run()
		dbh.db
			.insert(comments)
			.values([
				{ id: "m1", body: "hi", createdAt: ts },
				{ id: "m2", body: "ho", createdAt: ts },
				{ id: "m3", body: "trashed", createdAt: ts, deletedAt: ts },
			])
			.run()
		dbh.db
			.insert(tags)
			.values([
				{ id: "t1", name: "x", createdAt: ts, updatedAt: ts },
				{ id: "t2", name: "y", createdAt: ts, updatedAt: ts },
			])
			.run()
		dbh.db
			.insert(resCollections)
			.values([
				{ id: "col1", name: "one", createdAt: ts, updatedAt: ts },
				{ id: "col2", name: "two", createdAt: ts, updatedAt: ts },
			])
			.run()

		const device = await addDevice("Laptop")
		// The auto-record at creation already captured the seeded state.
		const entry = (await svc.summary()).devices[0]
		const record = entry?.latestRecord

		expect(record?.recordedAt).toBe(device.createdAt)
		expect(record?.resourceCount).toBe(2)
		expect(record?.characterCount).toBe(2)
		expect(record?.documentCount).toBe(1)
		expect(record?.folderCount).toBe(1)
		expect(record?.commentCount).toBe(2)
		expect(record?.tagCount).toBe(2)
		expect(record?.collectionCount).toBe(2)
		expect(record?.trashCount).toBe(1)
		expect(record?.storageBytes).toBe(usedBytes)
		expect(record?.resourceBytes).toBe(contentBytes)
		expect(storageService.getOverview).toHaveBeenCalled()
	})

	test("record create keeps only the latest snapshot per device", async () => {
		const device = await addDevice("Laptop")
		nowValue += 1 * DAY_MS
		await svc.recordCreate({ deviceId: device.id })
		nowValue += 1 * DAY_MS
		const third = await svc.recordCreate({ deviceId: device.id })

		expect(await recordCount()).toBe(1)
		const summary = (await svc.summary()).devices[0]
		expect(summary?.latestRecord?.id).toBe(third.id)
	})

	test("record create keeps the first snapshot as the latest baseline", async () => {
		await addDevice("Laptop")
		const entry = (await svc.summary()).devices[0]
		expect(entry?.latestRecord).toBeDefined()
		expect(await recordCount()).toBe(1)
	})

	test("current reports the live state without writing records", async () => {
		const ts = nowValue
		dbh.db
			.insert(resources)
			.values([
				{ id: "r1", name: "a", createdAt: ts, updatedAt: ts },
				{ id: "r2", name: "b", createdAt: ts, updatedAt: ts },
			])
			.run()
		await addDevice("Laptop")
		expect(await recordCount()).toBe(1)
		expect(storageService.getOverview).toHaveBeenCalledTimes(1)

		const live = await svc.current()
		expect(await recordCount()).toBe(1)
		expect(live.resourceCount).toBe(2)
		expect(live.characterCount).toBe(0)
		expect(live.documentCount).toBe(0)
		expect(live.folderCount).toBe(0)
		expect(live.commentCount).toBe(0)
		expect(live.tagCount).toBe(0)
		expect(live.collectionCount).toBe(0)
		expect(live.trashCount).toBe(0)
		expect(live.storageBytes).toBe(usedBytes)
		expect(live.resourceBytes).toBe(contentBytes)
		expect(storageService.getOverview).toHaveBeenCalledTimes(2)
	})

	test("summary device is not due inside the remind interval", async () => {
		setPref(SYNC_REMIND_DAYS_PREF, 7)
		const device = await addDevice("Laptop")
		const created = (await svc.summary()).devices[0]
		expect(created?.due).toBe(false)
		expect(created?.lastRecordedAt).toBe(device.createdAt)
		expect(created?.elapsedDays).toBe(0)
		nowValue += 2 * DAY_MS
		const entry = (await svc.summary()).devices[0]
		expect(entry?.due).toBe(false)
		expect(entry?.elapsedDays).toBe(2)
		expect(entry?.latestRecord?.recordedAt).toBe(device.createdAt)
	})

	test("summary device is due past the remind interval and resets on a new record", async () => {
		setPref(SYNC_REMIND_DAYS_PREF, 7)
		const device = await addDevice("Laptop")
		nowValue += 9 * DAY_MS
		expect((await svc.summary()).devices[0]?.due).toBe(true)
		nowValue += DAY_MS
		const record = await svc.recordCreate({ deviceId: device.id })
		const entry = (await svc.summary()).devices[0]
		expect(entry?.due).toBe(false)
		expect(entry?.elapsedDays).toBe(0)
		expect(entry?.latestRecord?.id).toBe(record.id)
	})

	test("summary due is independent per device", async () => {
		setPref(SYNC_REMIND_DAYS_PREF, 7)
		const a = await addDevice("Laptop")
		nowValue += 60_000
		await addDevice("Phone")
		// Phone never synced again; Laptop synced just now.
		nowValue += 9 * DAY_MS
		await svc.recordCreate({ deviceId: a.id })
		const entries = (await svc.summary()).devices
		expect(entries.find((entry) => entry.device.id === a.id)?.due).toBe(false)
		expect(entries.find((entry) => entry.device.name === "Phone")?.due).toBe(
			true,
		)
	})

	test("summary uses default remind interval when the pref is absent", async () => {
		await addDevice("Laptop")
		const summary = await svc.summary()
		expect(summary.remindDays).toBe(DEFAULT_SYNC_REMIND_DAYS)
		expect(summary.devices[0]?.due).toBe(false)
	})

	test("summary ignores malformed pref values", async () => {
		buildAsyncPrefRepository(dbh.db).upsert(
			SYNC_REMIND_DAYS_PREF,
			"not-a-number",
			nowValue,
		)
		const summary = await svc.summary()
		expect(summary.remindDays).toBe(DEFAULT_SYNC_REMIND_DAYS)
	})

	test("summary with no devices is the permanent warning state", async () => {
		const summary = await svc.summary()
		expect(summary.devices).toHaveLength(0)
	})
})
