import { mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDb } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createAutoSnapshotScheduler } from "./scheduler.ts"
import { type BackupService, createBackupService } from "./service.ts"

const HOUR_MS = 60 * 60 * 1000

function iso(value: string): Date {
	return new Date(value)
}

describe("auto snapshot scheduler", () => {
	let root: string
	let paths: ReturnType<typeof createStoragePaths>
	let dbh: ReturnType<typeof openDb>
	let svc: BackupService

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-scheduler-"))
		paths = createStoragePaths({ root })
		dbh = openDb(paths.runtimeDb())
		dbh.runMigrations()
		svc = createBackupService({
			db: dbh,
			paths,
			dbFilePath: paths.runtimeDb(),
			now: () => Date.now(),
			getActiveVersion: () => 1,
		})
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
		vi.useRealTimers()
	})

	async function autoCount(): Promise<number> {
		const list = await svc.list()
		return list.filter((b) => b.kind === "auto").length
	}

	/**
	 * Rewrite the newest auto snapshot's mtime to `ts`. The mocked clock
	 * never touches real filesystem timestamps, so staleness checks (which
	 * read `stat.mtimeMs`) need the file backdated explicitly.
	 */
	function stampNewestAutoMtime(ts: number): void {
		const dir = paths.latest.snapshots()
		// Match snapshot files only — the `.meta.json` sidecars share the
		// `auto-` prefix and would otherwise be picked by `.at(-1)`.
		const newest = readdirSync(dir)
			.filter((name) => name.startsWith("auto-") && name.endsWith(".sqlite"))
			.sort()
			.at(-1)
		if (newest === undefined) throw new Error("no auto snapshot on disk")
		// utimesSync rejects ms values on this platform; seconds work.
		const secs = Math.floor(ts / 1000)
		utimesSync(join(dir, newest), secs, secs)
	}

	test("takes a catch-up snapshot at start when none exist", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(iso("2026-01-01T10:00:00"))
		const scheduler = createAutoSnapshotScheduler({
			service: svc,
			keep: 3,
			isReadOnly: () => false,
		})
		await scheduler.start()
		expect(await autoCount()).toBe(1)
	})

	test("skips catch-up when the newest snapshot is fresh", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(iso("2026-01-01T10:00:00"))
		const first = createAutoSnapshotScheduler({
			service: svc,
			keep: 3,
			isReadOnly: () => false,
		})
		await first.start()
		expect(await autoCount()).toBe(1)
		stampNewestAutoMtime(Date.now())

		// A restart within the same day must not duplicate the snapshot.
		const second = createAutoSnapshotScheduler({
			service: svc,
			keep: 3,
			isReadOnly: () => false,
		})
		await second.start()
		expect(await autoCount()).toBe(1)
	})

	test("catches up when the newest snapshot is more than a day old", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(iso("2026-01-01T10:00:00"))
		const first = createAutoSnapshotScheduler({
			service: svc,
			keep: 3,
			isReadOnly: () => false,
		})
		await first.start()
		expect(await autoCount()).toBe(1)
		stampNewestAutoMtime(Date.now())

		// Host stayed offline for 25 hours; the next boot must re-snapshot.
		vi.setSystemTime(iso("2026-01-02T11:00:00"))
		const second = createAutoSnapshotScheduler({
			service: svc,
			keep: 3,
			isReadOnly: () => false,
		})
		await second.start()
		expect(await autoCount()).toBe(2)
	})

	test("fires again at the next local midnight", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(iso("2026-01-01T10:00:00"))
		const scheduler = createAutoSnapshotScheduler({
			service: svc,
			keep: 3,
			isReadOnly: () => false,
		})
		await scheduler.start()
		expect(await autoCount()).toBe(1)

		await vi.advanceTimersByTimeAsync(14 * HOUR_MS + 1000)
		expect(await autoCount()).toBe(2)
	})

	test("prunes to the configured window after every run", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(iso("2026-01-01T10:00:00"))
		const scheduler = createAutoSnapshotScheduler({
			service: svc,
			keep: 1,
			isReadOnly: () => false,
		})
		await scheduler.start()
		expect(await autoCount()).toBe(1)

		// Fire at midnight, then a full day later: two runs, one kept.
		await vi.advanceTimersByTimeAsync(14 * HOUR_MS + 1000)
		await vi.advanceTimersByTimeAsync(24 * HOUR_MS + 1000)
		expect(await autoCount()).toBe(1)
	})

	test("skips runs while the server is read-only", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(iso("2026-01-01T10:00:00"))
		const scheduler = createAutoSnapshotScheduler({
			service: svc,
			keep: 3,
			isReadOnly: () => true,
		})
		await scheduler.start()
		expect(await autoCount()).toBe(0)

		await vi.advanceTimersByTimeAsync(25 * HOUR_MS + 1000)
		expect(await autoCount()).toBe(0)
	})

	test("skips runs when the volume is below the low-disk threshold", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(iso("2026-01-01T10:00:00"))
		const onSkip = vi.fn()
		const scheduler = createAutoSnapshotScheduler({
			service: svc,
			keep: 3,
			isReadOnly: () => false,
			readFreeBytes: async () => 100,
			minFreeBytes: 1_000,
			onSkip,
		})
		await scheduler.start()
		expect(await autoCount()).toBe(0)
		expect(onSkip).toHaveBeenCalledWith("low_disk")

		await vi.advanceTimersByTimeAsync(25 * HOUR_MS + 1000)
		expect(await autoCount()).toBe(0)
		expect(onSkip).toHaveBeenCalledTimes(2)
	})

	test("a failing free-space probe does not block the run", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(iso("2026-01-01T10:00:00"))
		const scheduler = createAutoSnapshotScheduler({
			service: svc,
			keep: 3,
			isReadOnly: () => false,
			readFreeBytes: async () => undefined,
			minFreeBytes: 1_000,
		})
		await scheduler.start()
		expect(await autoCount()).toBe(1)
	})

	test("stop cancels the pending midnight run", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(iso("2026-01-01T10:00:00"))
		const scheduler = createAutoSnapshotScheduler({
			service: svc,
			keep: 3,
			isReadOnly: () => false,
		})
		await scheduler.start()
		expect(await autoCount()).toBe(1)

		scheduler.stop()
		await vi.advanceTimersByTimeAsync(25 * HOUR_MS + 1000)
		expect(await autoCount()).toBe(1)
	})
})
