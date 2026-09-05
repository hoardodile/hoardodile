import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	ensureBootstrapVersion,
	recoverVersionPublication,
} from "@hoardodile/host/hoard"
import { type DomainError, isDomainError } from "@hoardodile/shared"
import { openDb, schema } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createVersionService, type VersionService } from "./service.ts"

describe("version service", async () => {
	let root: string
	let dbh: ReturnType<typeof openDb>
	let svc: VersionService

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "ver-svc-"))
		ensureBootstrapVersion(root)
		const liveDbPath = join(root, "app.sqlite")
		dbh = openDb(liveDbPath)
		dbh.runMigrations()
		svc = createVersionService({
			db: dbh,
			storageRoot: root,
			readOnly: false,
		})
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("list returns single entry for bootstrap version", async () => {
		const entries = svc.list()
		expect(entries).toHaveLength(1)
		expect(entries[0]).toEqual({
			version: 1,
			current: true,
			active: true,
			dbSize: expect.any(Number),
		})
		expect(entries[0]?.dbSize).toBeGreaterThan(0)
	})

	test("preserves prepared plugin copies and requests maintenance when publication cannot finish", async () => {
		const plugin = join(root, "versions", "1", "plugins", "fixture")
		mkdirSync(plugin, { recursive: true })
		writeFileSync(join(plugin, "asset.txt"), "independent plugin contents")
		const onPublicationFailure = vi.fn()
		const service = createVersionService({
			db: dbh,
			storageRoot: root,
			readOnly: false,
			onPublicationFailure,
		})
		const collision = join(root, "versions", "2")
		await expect(
			service.create(
				{},
				{ onProgress: () => mkdirSync(collision, { recursive: true }) },
			),
		).rejects.toMatchObject({ code: "archive_publication_interrupted" })
		expect(onPublicationFailure).toHaveBeenCalledOnce()
		const work = join(root, "local", "archive-publication")
		expect(existsSync(join(work, "pending.json"))).toBe(true)
		expect(
			readFileSync(
				join(work, "next", "plugins", "fixture", "asset.txt"),
				"utf8",
			),
		).toBe("independent plugin contents")
		rmSync(collision, { recursive: true, force: true })
		await recoverVersionPublication(root)
		expect(service.current()).toBe(2)
		expect(
			readFileSync(join(collision, "plugins", "fixture", "asset.txt"), "utf8"),
		).toBe("independent plugin contents")
		expect(existsSync(join(work, "pending.json"))).toBe(false)
	})

	test("current and active return 1 after bootstrap", async () => {
		expect(svc.current()).toBe(1)
		expect(svc.active()).toBe(1)
	})

	test("create snapshots DB and bumps current version", async () => {
		const beforeSize = svc.list()[0]?.dbSize ?? 0
		expect(beforeSize).toBeGreaterThan(0)

		const result = await svc.create()
		expect(result.previous).toBe(1)
		expect(result.created).toBe(2)

		const entries = svc.list()
		expect(entries).toHaveLength(2)

		// Version 1 is now archived
		const v1 = entries.find((e) => e.version === 1)
		expect(v1).toBeDefined()
		expect(v1?.current).toBe(false)
		expect(v1?.active).toBe(false)
		expect(v1?.dbSize).toBeGreaterThan(0)

		// Version 2 is current (empty dir, so dbSize falls back to live DB)
		const v2 = entries.find((e) => e.version === 2)
		expect(v2).toBeDefined()
		expect(v2?.current).toBe(true)
		expect(v2?.active).toBe(true)
		expect(v2?.dbSize).toBe(beforeSize)
	})

	test("create throws when in read-only mode", async () => {
		const roSvc = createVersionService({
			db: dbh,
			storageRoot: root,
			readOnly: true,
		})
		try {
			await roSvc.create()
			expect.unreachable("should have thrown")
		} catch (err) {
			// The versioned-write gate lives in the host package; its
			// DomainError is a structural copy, so check the shape.
			expect(isDomainError(err)).toBe(true)
			expect((err as DomainError).kind).toBe("version.read_only_archive")
		}
	})

	test("switchTo updates active version", async () => {
		await svc.create()
		svc.switchTo(1)

		expect(svc.active()).toBe(1)
		const entries = svc.list()
		const v1 = entries.find((e) => e.version === 1)
		const v2 = entries.find((e) => e.version === 2)
		expect(v1?.active).toBe(true)
		expect(v2?.active).toBe(false)
	})

	test("switchTo throws for unknown version", async () => {
		try {
			svc.switchTo(99)
			expect.unreachable("should have thrown")
		} catch (err) {
			// The versioned-write gate now lives in the host package; its
			// DomainError is a structural copy, so check the shape rather
			// than the class identity.
			expect(isDomainError(err)).toBe(true)
			expect((err as DomainError).kind).toBe("version.not_found")
		}
	})

	test("list reflects on-disk changes made by another instance", async () => {
		// Simulate another service instance writing the active version
		const other = createVersionService({
			db: dbh,
			storageRoot: root,
			readOnly: false,
		})
		await other.create()
		other.switchTo(1)

		// Original service sees the new state without re-instantiation
		expect(svc.active()).toBe(1)
		expect(svc.current()).toBe(2)
		const entries = svc.list()
		expect(entries.find((e) => e.version === 1)?.active).toBe(true)
		expect(entries.find((e) => e.version === 2)?.active).toBe(false)
	})

	test("dbSize for archived version reads snapshot file, not live DB", async () => {
		// Seed some data to make live DB grow
		dbh.db
			.insert(schema.auth)
			.values({ singleton: 1, passwordHash: "x", updatedAt: 1 })
			.run()
		const beforeCreate = svc.list()[0]?.dbSize ?? 0

		await svc.create()

		const entries = svc.list()
		const v1 = entries.find((e) => e.version === 1)
		const v2 = entries.find((e) => e.version === 2)

		// v1 dbSize comes from the archived snapshot file
		expect(v1?.dbSize).toBeGreaterThan(0)
		// v2 dbSize falls back to live DB (same size as before create, roughly)
		expect(v2?.dbSize).toBeGreaterThanOrEqual(beforeCreate)
	})

	test("create stores createdAt and note for the archived version", async () => {
		const before = Date.now()
		await svc.create({ note: "milestone" })
		const after = Date.now()
		const entries = svc.list()
		const v1 = entries.find((e) => e.version === 1)
		expect(v1?.note).toBe("milestone")
		expect(v1?.createdAt).toBeGreaterThanOrEqual(before)
		expect(v1?.createdAt).toBeLessThanOrEqual(after)
	})

	test("updateMeta persists and clears name/note for the current version", async () => {
		await svc.create()
		const entriesBefore = svc.list()
		const current = entriesBefore.find((e) => e.current)
		expect(current).toBeDefined()

		await svc.updateMeta(current!.version, { name: "v2", note: "updated note" })
		let entries = svc.list()
		const updated = entries.find((e) => e.version === current!.version)
		expect(updated?.name).toBe("v2")
		expect(updated?.note).toBe("updated note")

		await svc.updateMeta(current!.version, { name: "", note: "" })
		entries = svc.list()
		const cleared = entries.find((e) => e.version === current!.version)
		expect(cleared?.name).toBeUndefined()
		expect(cleared?.note).toBeUndefined()
	})

	test("updateMeta throws for unknown version", async () => {
		try {
			await svc.updateMeta(99, { note: "note" })
			expect.unreachable("should have thrown")
		} catch (err) {
			expect(isDomainError(err)).toBe(true)
			expect((err as DomainError).kind).toBe("version.not_found")
		}
	})

	test("updateMeta throws when editing a past archived version", async () => {
		await svc.create()
		try {
			await svc.updateMeta(1, { note: "should fail" })
			expect.unreachable("should have thrown")
		} catch (err) {
			expect(isDomainError(err)).toBe(true)
			expect((err as DomainError).kind).toBe("version.read_only_archive")
		}
	})
})
