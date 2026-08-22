import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { writeStagedPoolFile } from "@hoardodile/host/hoard"
import { RESOURCE_DISLIKE_CANCEL_WINDOW_MS } from "@hoardodile/schemas/res"
import type { UserAction } from "src/domain/trace/actions.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import {
	createStoragePaths,
	type StoragePaths,
} from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createResourceService, type ResService } from "./service.ts"
import { createTestHooks, createTestRegistry } from "./test-registry.ts"

/**
 * Resource-service ↔ trace wiring: the `onUserAction` callback must fire
 * exactly once per discrete action with the entity name snapshot, and
 * hard deletes must still report the name after the row is gone.
 */
describe("resource service trace wiring", () => {
	let root: string
	let dbh: DbHandles
	let paths: StoragePaths
	let svc: ResService
	let actions: UserAction[]
	let nowMs: number

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-res-trace-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
		paths = createStoragePaths({ root })
		nowMs = 1_000
		actions = []
		svc = createResourceService({
			db: dbh.db,
			paths,
			pluginHooks: createTestHooks(createTestRegistry()),
			readOnly: { current: false },
			now: () => nowMs,
			newId: () => `res-${actions.length}`,
			onUserAction: (action) => {
				actions.push(action)
			},
		})
	})

	afterEach(async () => {
		await svc.drainMetaQueue()
		dbh.close()
		for (let attempt = 0; ; attempt++) {
			try {
				rmSync(root, { recursive: true, force: true })
				break
			} catch (err) {
				if (attempt >= 4) throw err
				await new Promise((resolve) => setTimeout(resolve, 100))
			}
		}
	})

	test("create records a resource.import with the resolved name", async () => {
		const r = await svc.create({ name: "Manga A", sourceName: "Site X" })
		expect(actions).toHaveLength(1)
		expect(actions[0]).toEqual({
			action: "resource.import",
			entityType: "resource",
			entityId: r.id,
			entityName: "Manga A",
			detail: { sourceName: "Site X" },
		})
	})

	test("create with staged files records the file count", async () => {
		const fileIds = ["f1", "f2", "f3"]
		for (const fileId of fileIds) {
			await writeStagedPoolFile(
				paths,
				fileId,
				"pixel.png",
				Readable.from([Buffer.from("x")]),
			)
		}
		await svc.create({ name: "Multifile", files: fileIds })
		expect(actions[0]?.detail).toEqual({ fileCount: 3 })
	})

	test("failed create records nothing", async () => {
		await expect(
			svc.create({ name: "Truncated", files: ["missing-file-id"] }),
		).rejects.toThrow()
		expect(actions).toHaveLength(0)
	})

	test("softDelete and restore each record an event", async () => {
		const r = await svc.create({ name: "Rover" })
		actions.length = 0
		await svc.softDelete(r.id)
		expect(actions).toHaveLength(1)
		expect(actions[0]).toMatchObject({
			action: "resource.softDelete",
			entityId: r.id,
			entityName: "Rover",
		})
		await svc.restore(r.id)
		expect(actions).toHaveLength(2)
		expect(actions[1]).toMatchObject({
			action: "resource.restore",
			entityId: r.id,
			entityName: "Rover",
		})
	})

	test("hardDelete records the name snapshot after the row is gone", async () => {
		const r = await svc.create({ name: "Rare" })
		await svc.softDelete(r.id)
		actions.length = 0
		await svc.hardDelete(r.id)
		expect(actions).toHaveLength(1)
		expect(actions[0]).toEqual({
			action: "resource.hardDelete",
			entityType: "resource",
			entityId: r.id,
			entityName: "Rare",
		})
	})

	test("softDeleteMany records one event per resource", async () => {
		const a = await svc.create({ name: "A" })
		const b = await svc.create({ name: "B" })
		actions.length = 0
		const result = await svc.softDeleteMany([a.id, b.id])
		expect(result.failures).toHaveLength(0)
		expect(actions.map((x) => x.entityId).sort()).toEqual([a.id, b.id].sort())
	})

	test("dislike add and cancel within the 24h window both record events", async () => {
		const r = await svc.create({ name: "Takeaway" })
		actions.length = 0
		const added = await svc.addDislike(r.id)
		expect(added.action).toBe("added")
		expect(actions).toHaveLength(1)
		expect(actions[0]).toMatchObject({
			action: "resource.dislike.add",
			entityId: r.id,
			entityName: "Takeaway",
		})
		const cancelled = await svc.addDislike(r.id)
		expect(cancelled.action).toBe("cancelled")
		expect(actions).toHaveLength(2)
		expect(actions[1]).toMatchObject({
			action: "resource.dislike.cancel",
			entityId: r.id,
			entityName: "Takeaway",
		})
	})

	test("dislike after the cancel window records another add", async () => {
		const r = await svc.create({ name: "Takeaway 2" })
		await svc.addDislike(r.id)
		actions.length = 0
		nowMs += RESOURCE_DISLIKE_CANCEL_WINDOW_MS
		const added = await svc.addDislike(r.id)
		expect(added.action).toBe("added")
		expect(actions[0]?.action).toBe("resource.dislike.add")
	})
})
