import { DEFAULT_SYNC_REMIND_DAYS } from "@hoardodile/schemas"
import { buildAsyncPrefRepository } from "src/domain/prefs/repo.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
	createSyncService,
	SYNC_REMIND_DAYS_PREF,
	type SyncService,
} from "./service.ts"

describe("sync reminder service", () => {
	let dbh: DbHandles
	let nowValue: number
	let svc: SyncService

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
		nowValue = 1_000_000
		svc = createSyncService({
			db: dbh.db,
			now: () => nowValue,
		})
	})

	afterEach(() => {
		dbh.close()
	})

	function setPref(key: string, value: string) {
		buildAsyncPrefRepository(dbh.db).upsert(key, value, nowValue)
	}

	test("summary uses the default remind interval when the pref is absent", async () => {
		const summary = await svc.summary()
		expect(summary.remindDays).toBe(DEFAULT_SYNC_REMIND_DAYS)
	})

	test("setRemindDays persists and summary reads it back", async () => {
		await svc.setRemindDays(14)
		expect((await svc.summary()).remindDays).toBe(14)
		expect(
			buildAsyncPrefRepository(dbh.db).get(SYNC_REMIND_DAYS_PREF)?.value,
		).toBe("14")
	})

	test("summary ignores malformed pref values", async () => {
		setPref(SYNC_REMIND_DAYS_PREF, "not-a-number")
		expect((await svc.summary()).remindDays).toBe(DEFAULT_SYNC_REMIND_DAYS)
	})

	test("setRemindDays rejects values outside 1–365", async () => {
		await expect(svc.setRemindDays(0)).rejects.toThrow(
			"Reminder days must be between 1 and 365",
		)
		await expect(svc.setRemindDays(366)).rejects.toThrow(
			"Reminder days must be between 1 and 365",
		)
	})
})
