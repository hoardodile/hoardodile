import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureBootstrapVersion } from "@hoardodile/host/hoard"
import { createCharacterService } from "src/domain/char/service.ts"
import { createResourceService } from "src/domain/res/service.ts"
import { createTestHooks } from "src/domain/res/test-registry.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { stageViewCloneDb } from "src/infra/storage/version-view.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createVersionService } from "./service.ts"

describe("cross-version data integrity", () => {
	let root: string
	let liveDbPath: string
	let dbh: ReturnType<typeof openDb>
	let paths: ReturnType<typeof createStoragePaths>

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "ver-integ-"))
		ensureBootstrapVersion(root)
		liveDbPath = join(root, "app.sqlite")
		dbh = openDb(liveDbPath)
		dbh.runMigrations()
		paths = createStoragePaths({ root })
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("snapshot preserves all data; read-only clone is queryable", async () => {
		// ── Phase 1: Create data in version 1 ──────────────────────────────
		const resSvc = createResourceService({
			db: dbh.db,
			paths,
			pluginHooks: createTestHooks(),
			readOnly: { current: false },
		})
		const charSvc = createCharacterService({
			db: dbh.db,
			paths,
			readOnly: { current: false },
		})

		await resSvc.create({ name: "Alpha Resource" })
		await charSvc.create({ name: "Alice" })

		// ── Phase 2: Publish version 2 ─────────────────────────────────────
		const versionSvc = createVersionService({
			db: dbh,
			storageRoot: root,
			readOnly: false,
		})
		const publish = await versionSvc.create()
		expect(publish.previous).toBe(1)
		expect(publish.created).toBe(2)

		// ── Phase 3: Verify version 1 snapshot integrity ───────────────────
		const snapshotPath = join(root, "versions", "1", "app.sqlite")
		expect(existsSync(snapshotPath)).toBe(true)
		const snap = openDb(snapshotPath, { readonly: true })

		// ── Phase 4: Open read-only clone and verify data ──────────────────
		const clonePath = stageViewCloneDb(paths, 1)
		const clone = openDb(clonePath, { readonly: true })

		try {
			expect(snap.integrityCheck()).toBe(true)
			expect(clone.integrityCheck()).toBe(true)

			// Query the clone directly through Drizzle (synchronous)
			const resources = clone.db.select().from(schema.resources).all()
			expect(resources).toHaveLength(1)
			expect(resources[0]?.name).toBe("Alpha Resource")

			const characters = clone.db.select().from(schema.characters).all()
			expect(characters).toHaveLength(1)
			expect(characters[0]?.name).toBe("Alice")
		} finally {
			clone.close()
			snap.close()
		}
	})

	test("current version remains writable after publish", async () => {
		const resSvc = createResourceService({
			db: dbh.db,
			paths,
			pluginHooks: createTestHooks(),
			readOnly: { current: false },
		})
		const charSvc = createCharacterService({
			db: dbh.db,
			paths,
			readOnly: { current: false },
		})

		// Seed data in v1
		await resSvc.create({ name: "V1-Resource" })
		await charSvc.create({ name: "Alice" })

		// Publish v2
		const versionSvc = createVersionService({
			db: dbh,
			storageRoot: root,
			readOnly: false,
		})
		versionSvc.create()

		// Update paths to current version 2
		paths = createStoragePaths({ root, latestVersion: 2 })
		const resSvcV2 = createResourceService({
			db: dbh.db,
			paths,
			pluginHooks: createTestHooks(),
			readOnly: { current: false },
		})
		const charSvcV2 = createCharacterService({
			db: dbh.db,
			paths,
			readOnly: { current: false },
		})

		// Write new data into the current version
		const newRes = await resSvcV2.create({ name: "V2-Resource" })
		const newChar = await charSvcV2.create({ name: "Bob" })

		expect(newRes.name).toBe("V2-Resource")
		expect(newChar.name).toBe("Bob")

		// Verify live DB sees all data (v1 + v2 rows)
		const allResources = dbh.db.select().from(schema.resources).all()
		expect(allResources).toHaveLength(2)
		const allChars = dbh.db.select().from(schema.characters).all()
		expect(allChars).toHaveLength(2)
	})
})
