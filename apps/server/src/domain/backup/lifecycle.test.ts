import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createResourceService } from "src/domain/res/service.ts"
import { createTestHooks } from "src/domain/res/test-registry.ts"
import { openDb } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createBackupService } from "./service.ts"
import { applyPendingRestore } from "./startup.ts"

/**
 * End-to-end simulation of the manual-sync workflow: host A creates data
 * and a backup, the operator copies the backup file to host B's shared
 * folder (robocopy / Syncthing / USB), and host B restores. Data appears.
 */
describe("backup lifecycle across two hosts", () => {
	let rootA: string
	let rootB: string

	beforeEach(() => {
		rootA = mkdtempSync(join(tmpdir(), "app-hostA-"))
		rootB = mkdtempSync(join(tmpdir(), "app-hostB-"))
	})

	afterEach(() => {
		rmSync(rootA, { recursive: true, force: true })
		rmSync(rootB, { recursive: true, force: true })
	})

	test("host A backup -> sync -> host B restore surfaces the data", async () => {
		// ── host A: create a resource + snapshot. ─────────────────────────
		const pathsA = createStoragePaths({ root: rootA })
		const dbFileA = pathsA.runtimeDb()
		const dbhA = openDb(dbFileA)
		dbhA.runMigrations()
		const svcA = createResourceService({
			pluginHooks: createTestHooks(),
			db: dbhA.db,
			paths: pathsA,
			readOnly: { current: false },
		})
		const resource = await svcA.create({
			name: "host-a-original",
		})
		expect(resource.id).toBeTruthy()

		const backupSvcA = createBackupService({
			db: dbhA,
			paths: pathsA,
			dbFilePath: dbFileA,
		})
		const snapshot = await backupSvcA.create()
		dbhA.close()

		// ── "sync": carry the backup file across to host B. ───────────────
		const pathsB = createStoragePaths({ root: rootB })
		mkdirSync(pathsB.active.dbBackups(), { recursive: true })
		// host B paths
		copyFileSync(
			pathsA.active.dbBackup(snapshot.fileName),
			pathsB.active.dbBackup(snapshot.fileName),
		)

		// ── host B: no live DB yet. prepareRestore stages + writes marker. ─
		const dbFileB = pathsB.runtimeDb()
		// Touch host B's DB so the swap has something to move to trash.
		const dbhB0 = openDb(dbFileB)
		dbhB0.runMigrations()
		const svcB0 = createResourceService({
			pluginHooks: createTestHooks(),
			db: dbhB0.db,
			paths: pathsB,
			readOnly: { current: false },
		})
		const existingOnB = await svcB0.list({})
		expect(existingOnB.rows).toHaveLength(0)
		const backupSvcB = createBackupService({
			db: dbhB0,
			paths: pathsB,
			dbFilePath: dbFileB,
		})
		await backupSvcB.prepareRestore(snapshot.fileName)
		dbhB0.close()

		// ── supervisor "restart": apply pending restore before reopening. ─
		const result = applyPendingRestore({ paths: pathsB })
		expect(result.applied).toBe(true)

		// ── host B reopens and reads A's data. ────────────────────────────
		const dbhB = openDb(dbFileB)
		dbhB.runMigrations()
		const svcB = createResourceService({
			pluginHooks: createTestHooks(),
			db: dbhB.db,
			paths: pathsB,
			readOnly: { current: false },
		})
		const listing = await svcB.list({})
		expect(listing.rows.map((r) => r.name)).toContain("host-a-original")
		dbhB.close()
	})
})
