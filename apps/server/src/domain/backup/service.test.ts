import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DomainError } from "@hoardodile/shared"
import { characters } from "src/domain/char/schema.ts"
import { documents } from "src/domain/doc/schema.ts"
import { resources } from "src/domain/res/schema.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { readPendingRestoreMarker } from "./marker.ts"
import { type BackupService, createBackupService } from "./service.ts"
import { applyPendingRestore } from "./startup.ts"

describe("backup service", () => {
	let root: string
	let dbFilePath: string
	let paths: ReturnType<typeof createStoragePaths>
	let dbh: ReturnType<typeof openDb>
	let svc: BackupService
	let nowSpy: { value: number }

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-backup-"))
		paths = createStoragePaths({ root })
		dbFilePath = paths.runtimeDb()
		dbh = openDb(dbFilePath)
		dbh.runMigrations()
		nowSpy = { value: 1_700_000_000_000 }
		svc = createBackupService({
			db: dbh,
			paths,
			dbFilePath,
			now: () => nowSpy.value++,
			getActiveVersion: () => 1,
		})
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("create writes a consistent snapshot that passes integrity_check", async () => {
		const summary = await svc.create()
		expect(summary.fileName).toMatch(/^app-\d+\.sqlite$/)
		expect(summary.name).toBeUndefined()
		expect(summary.size).toBeGreaterThan(0)
		const path = paths.active.dbBackup(summary.fileName)
		expect(existsSync(path)).toBe(true)
		// Open the snapshot read-only and verify integrity via a fresh handle.
		const snap = openDb(path)
		expect(snap.integrityCheck()).toBe(true)
		snap.close()
	})

	test("create never carries the auth row into the snapshot", async () => {
		// Configure the live DB so the snapshot would contain a credential
		// if stripping were skipped.
		const hash = "argon2id$configured-password-hash"
		dbh.db
			.insert(schema.auth)
			.values({ singleton: 1, passwordHash: hash, updatedAt: 1 })
			.run()

		const summary = await svc.create()

		const snap = openDb(paths.active.dbBackup(summary.fileName))
		try {
			const row = snap.db.select().from(schema.auth).get()
			expect(row).toBeUndefined()
		} finally {
			snap.close()
		}
		// The live DB keeps its auth row untouched.
		expect(dbh.db.select().from(schema.auth).get()?.passwordHash).toBe(hash)
	})

	test("list returns snapshots newest-first and ignores foreign files", async () => {
		await svc.create()
		await svc.create()
		const dir = paths.active.dbBackups()
		writeFileSync(join(dir, "not-a-backup.txt"), "hi")
		const list = await svc.list()
		expect(list).toHaveLength(2)
		expect(list[0]?.createdAt).toBeGreaterThanOrEqual(list[1]?.createdAt ?? 0)
	})

	test("delete removes the file; missing name throws NOT_FOUND", async () => {
		const first = await svc.create()
		await svc.delete(first.fileName)
		expect(existsSync(paths.active.dbBackup(first.fileName))).toBe(false)

		try {
			await svc.delete(first.fileName)
			throw new Error("expected throw")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			expect((err as DomainError).kind).toBe("backup.not_found")
		}
	})

	test("prepareRestore stages the pending file and writes a marker", async () => {
		const summary = await svc.create()
		await svc.prepareRestore(summary.fileName)
		const marker = readPendingRestoreMarker(paths)
		expect(marker?.sourceName).toBe(summary.fileName)
		expect(marker?.dbFilePath).toBe(dbFilePath)
		expect(existsSync(marker?.pendingPath ?? "")).toBe(true)
	})

	test("prepareRestore rejects unknown names", async () => {
		try {
			await svc.prepareRestore("app-missing.sqlite")
			throw new Error("expected throw")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			expect((err as DomainError).kind).toBe("backup.not_found")
		}
	})

	test("prepareRestore rejects corrupt snapshots", async () => {
		const summary = await svc.create()
		// Corrupt the snapshot by truncating it.
		writeFileSync(paths.active.dbBackup(summary.fileName), "not a sqlite file")
		try {
			await svc.prepareRestore(summary.fileName)
			throw new Error("expected throw")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			expect((err as DomainError).kind).toBe("backup.integrity_failed")
		}
	})

	test("create stores note and activeVersion in sidecar meta", async () => {
		const summary = await svc.create({ note: "before migration" })
		expect(summary.note).toBe("before migration")
		expect(summary.activeVersion).toBe(1)
		const metaPath = `${paths.active.dbBackup(summary.fileName)}.meta.json`
		expect(existsSync(metaPath)).toBe(true)
	})

	test("snapshots record live entity counts, excluding trashed rows", async () => {
		dbh.db
			.insert(resources)
			.values({
				id: "res-1",
				name: "r",
				createdAt: 1,
				updatedAt: 1,
			})
			.run()
		dbh.db
			.insert(resources)
			.values({
				id: "res-2",
				name: "r2",
				createdAt: 1,
				updatedAt: 1,
				deletedAt: 1,
			})
			.run()
		dbh.db
			.insert(characters)
			.values({ id: "char-1", name: "c", createdAt: 1, updatedAt: 1 })
			.run()
		dbh.db
			.insert(documents)
			.values({
				id: "doc-1",
				kind: "document",
				title: "d",
				createdAt: 1,
				updatedAt: 1,
			})
			.run()

		const summary = await svc.create()
		expect(summary.counts).toEqual({
			resources: 1,
			characters: 1,
			documents: 1,
		})
		// Trashed entities are excluded from the counts.
		const trashedOnly = await svc.createAuto()
		expect(trashedOnly.counts).toEqual({
			resources: 1,
			characters: 1,
			documents: 1,
		})
	})

	test("updateMeta persists and clears note/name", async () => {
		const summary = await svc.create()
		await svc.updateMeta(summary.fileName, {
			name: "migration",
			note: "updated note",
		})
		let list = await svc.list()
		expect(list[0]?.name).toBe("migration")
		expect(list[0]?.note).toBe("updated note")

		await svc.updateMeta(summary.fileName, { name: "", note: "" })
		list = await svc.list()
		expect(list[0]?.name).toBeUndefined()
		expect(list[0]?.note).toBeUndefined()
	})

	test("updateMeta throws for unknown backup", async () => {
		try {
			await svc.updateMeta("app-missing.sqlite", { note: "note" })
			throw new Error("expected throw")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			expect((err as DomainError).kind).toBe("backup.not_found")
		}
	})

	test("delete and updateMeta refuse to modify a backup stored in an archived version", async () => {
		// Seed a backup under version 1, then advance to version 2.
		const summary = await svc.create()
		mkdirSync(join(root, "versions", "2"), { recursive: true })
		const v2Paths = createStoragePaths({ root, latestVersion: 2 })
		const v2Svc = createBackupService({
			db: dbh,
			paths: v2Paths,
			dbFilePath,
			now: () => nowSpy.value++,
			getActiveVersion: () => 2,
		})

		try {
			await v2Svc.delete(summary.fileName)
			throw new Error("expected throw")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			expect((err as DomainError).kind).toBe("backup.archived_readonly")
		}

		try {
			await v2Svc.updateMeta(summary.fileName, { note: "nope" })
			throw new Error("expected throw")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			expect((err as DomainError).kind).toBe("backup.archived_readonly")
		}

		// The archived backup must remain untouched.
		expect(existsSync(paths.atVersion(1).dbBackup(summary.fileName))).toBe(true)
	})

	test("create always writes into the current version directory", async () => {
		// Advance to version 2 while the active (viewing) version stays at 1.
		mkdirSync(join(root, "versions", "2"), { recursive: true })
		const mixedPaths = createStoragePaths({
			root,
			activeVersion: 1,
			latestVersion: 2,
		})
		const mixedSvc = createBackupService({
			db: dbh,
			paths: mixedPaths,
			dbFilePath,
			now: () => nowSpy.value++,
			getActiveVersion: () => 1,
		})

		const summary = await mixedSvc.create()
		expect(existsSync(mixedPaths.latest.dbBackup(summary.fileName))).toBe(true)
		expect(existsSync(mixedPaths.active.dbBackup(summary.fileName))).toBe(false)
	})
})

describe("auto snapshots", () => {
	let root: string
	let dbFilePath: string
	let paths: ReturnType<typeof createStoragePaths>
	let dbh: ReturnType<typeof openDb>
	let svc: BackupService
	let nowSpy: { value: number }

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-auto-"))
		paths = createStoragePaths({ root })
		dbFilePath = paths.runtimeDb()
		dbh = openDb(dbFilePath)
		dbh.runMigrations()
		nowSpy = { value: 1_800_000_000_000 }
		svc = createBackupService({
			db: dbh,
			paths,
			dbFilePath,
			now: () => nowSpy.value++,
			getActiveVersion: () => 1,
		})
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("createAuto writes into the snapshots sibling folder and passes integrity", async () => {
		const summary = await svc.createAuto()
		expect(summary.fileName).toMatch(/^auto-\d+\.sqlite$/)
		expect(summary.kind).toBe("auto")
		expect(summary.size).toBeGreaterThan(0)
		expect(summary.activeVersion).toBe(1)
		expect(existsSync(paths.active.snapshot(summary.fileName))).toBe(true)
		// The manual and automatic folders stay separate.
		expect(existsSync(paths.active.dbBackup(summary.fileName))).toBe(false)
		const snap = openDb(paths.active.snapshot(summary.fileName))
		expect(snap.integrityCheck()).toBe(true)
		snap.close()
	})

	test("createAuto never carries the auth row into the snapshot", async () => {
		const hash = "argon2id$configured-password-hash"
		dbh.db
			.insert(schema.auth)
			.values({ singleton: 1, passwordHash: hash, updatedAt: 1 })
			.run()
		const summary = await svc.createAuto()
		const snap = openDb(paths.active.snapshot(summary.fileName))
		try {
			expect(snap.db.select().from(schema.auth).get()).toBeUndefined()
		} finally {
			snap.close()
		}
	})

	test("pruneAuto keeps one snapshot per day, for the newest days", async () => {
		// Four snapshots on four distinct days.
		const created: Awaited<ReturnType<BackupService["createAuto"]>>[] = []
		for (let day = 0; day < 4; day++) {
			nowSpy.value = 1_800_000_000_000 + day * 86_400_000
			created.push(await svc.createAuto())
		}

		await svc.pruneAuto(3)

		const remaining = (await svc.list())
			.filter((b) => b.kind === "auto")
			.map((b) => b.fileName)
			.sort()
		expect(remaining).toHaveLength(3)
		// The oldest day is pruned; the other three survive.
		expect(remaining).not.toContain(created[0]?.fileName)
		expect(remaining).toContain(created[1]?.fileName)
		expect(remaining).toContain(created[2]?.fileName)
		expect(remaining).toContain(created[3]?.fileName)
		expect(existsSync(paths.active.snapshot(created[0]?.fileName ?? ""))).toBe(
			false,
		)
	})

	test("pruneAuto collapses same-day restart churn to a single snapshot", async () => {
		// Three snapshots taken within the same day (restart churn).
		const first = await svc.createAuto()
		const second = await svc.createAuto()
		const third = await svc.createAuto()

		await svc.pruneAuto(3)

		const remaining = (await svc.list()).filter((b) => b.kind === "auto")
		expect(remaining).toHaveLength(1)
		// The newest file of the day survives.
		expect(remaining[0]?.fileName).toBe(third.fileName)
		expect(existsSync(paths.active.snapshot(first.fileName))).toBe(false)
		expect(existsSync(paths.active.snapshot(second.fileName))).toBe(false)
	})

	test("getAutoStatus reports configuration and the newest snapshot", async () => {
		const statusSvc = createBackupService({
			db: dbh,
			paths,
			dbFilePath,
			now: () => nowSpy.value++,
			getActiveVersion: () => 1,
			autoSnapshot: { enabled: true, keep: 3 },
		})
		// No snapshots yet.
		expect(await statusSvc.getAutoStatus()).toEqual({
			enabled: true,
			keep: 3,
			lastAt: null,
		})
		await statusSvc.createAuto()
		const status = await statusSvc.getAutoStatus()
		expect(status.enabled).toBe(true)
		expect(status.keep).toBe(3)
		expect(status.lastAt).toBeGreaterThan(0)
	})

	test("list merges manual and auto snapshots with their kind", async () => {
		await svc.create()
		await svc.createAuto()
		const list = await svc.list()
		expect(list).toHaveLength(2)
		const manual = list.find((b) => b.kind === "manual")
		const auto = list.find((b) => b.kind === "auto")
		expect(manual?.fileName).toMatch(/^app-/)
		expect(auto?.fileName).toMatch(/^auto-/)
	})

	test("updateMeta refuses auto snapshots", async () => {
		const summary = await svc.createAuto()
		try {
			await svc.updateMeta(summary.fileName, { note: "nope" })
			throw new Error("expected throw")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			expect((err as DomainError).kind).toBe("backup.auto_readonly")
		}
	})

	test("delete removes a current-version auto snapshot", async () => {
		const summary = await svc.createAuto()
		await svc.delete(summary.fileName)
		expect(existsSync(paths.active.snapshot(summary.fileName))).toBe(false)
	})

	test("prepareRestore resolves an auto snapshot", async () => {
		const summary = await svc.createAuto()
		await svc.prepareRestore(summary.fileName)
		const marker = readPendingRestoreMarker(paths)
		expect(marker?.sourceName).toBe(summary.fileName)
	})

	test("archived auto snapshots stay listed and downloadable, but never restorable or writable", async () => {
		const auto = await svc.createAuto()
		// Advance to version 2; the snapshot freezes in version 1.
		mkdirSync(join(root, "versions", "2"), { recursive: true })
		const v2Paths = createStoragePaths({ root, latestVersion: 2 })
		const v2Svc = createBackupService({
			db: dbh,
			paths: v2Paths,
			dbFilePath,
			now: () => nowSpy.value++,
			getActiveVersion: () => 2,
		})

		const list = await v2Svc.list()
		expect(
			list.some((b) => b.fileName === auto.fileName && b.kind === "auto"),
		).toBe(true)

		// Downloads (read-only) still resolve across versions.
		expect(await v2Svc.resolveFilePath(auto.fileName)).toBe(
			paths.atVersion(1).snapshot(auto.fileName),
		)

		// Restore is refused: a frozen snapshot must never roll the live DB
		// back across a version boundary.
		try {
			await v2Svc.prepareRestore(auto.fileName)
			throw new Error("expected throw")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			expect((err as DomainError).kind).toBe("backup.archived_readonly")
		}

		// Writable operations refuse the frozen file too.
		try {
			await v2Svc.delete(auto.fileName)
			throw new Error("expected throw")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			expect((err as DomainError).kind).toBe("backup.archived_readonly")
		}
		expect(existsSync(paths.atVersion(1).snapshot(auto.fileName))).toBe(true)
	})

	test("restore refuses a manual backup frozen in an archived version", async () => {
		const manual = await svc.create()
		mkdirSync(join(root, "versions", "2"), { recursive: true })
		const v2Paths = createStoragePaths({ root, latestVersion: 2 })
		const v2Svc = createBackupService({
			db: dbh,
			paths: v2Paths,
			dbFilePath,
			now: () => nowSpy.value++,
			getActiveVersion: () => 2,
		})

		try {
			await v2Svc.prepareRestore(manual.fileName)
			throw new Error("expected throw")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			expect((err as DomainError).kind).toBe("backup.archived_readonly")
		}
	})

	test("pruneAuto never touches archived versions", async () => {
		const auto = await svc.createAuto()
		mkdirSync(join(root, "versions", "2"), { recursive: true })
		const v2Paths = createStoragePaths({ root, latestVersion: 2 })
		const v2Svc = createBackupService({
			db: dbh,
			paths: v2Paths,
			dbFilePath,
			now: () => nowSpy.value++,
			getActiveVersion: () => 2,
		})

		await v2Svc.createAuto()
		await v2Svc.pruneAuto(1)

		// Version 1's snapshot is frozen and survives the prune.
		expect(existsSync(paths.atVersion(1).snapshot(auto.fileName))).toBe(true)
		const remaining = await v2Svc.list()
		expect(remaining.filter((b) => b.kind === "auto")).toHaveLength(2)
	})
})

describe("applyPendingRestore", () => {
	let root: string
	let paths: ReturnType<typeof createStoragePaths>
	let dbFilePath: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-restore-"))
		paths = createStoragePaths({ root })
		dbFilePath = paths.runtimeDb()
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("no marker -> no-op", () => {
		const result = applyPendingRestore({ paths })
		expect(result.applied).toBe(false)
	})

	test("marker with pending source -> swaps live DB into trash", async () => {
		// Seed a pre-existing live DB
		const dbh = openDb(dbFilePath)
		dbh.runMigrations()
		dbh.close()
		const originalSize = statSync(dbFilePath).size
		expect(originalSize).toBeGreaterThan(0)

		// Create a snapshot to be restored.
		const dbh2 = openDb(dbFilePath)
		const svc = createBackupService({
			db: dbh2,
			paths,
			dbFilePath,
			getActiveVersion: () => 1,
		})
		const snap = await svc.create()
		await svc.prepareRestore(snap.fileName)
		dbh2.close()

		const result = applyPendingRestore({ paths })
		expect(result.applied).toBe(true)
		if (!result.applied) throw new Error("unreachable")
		expect(result.sourceName).toBe(snap.fileName)
		expect(existsSync(result.previousPath)).toBe(true)
		expect(existsSync(dbFilePath)).toBe(true)
		// Marker is cleared.
		expect(readPendingRestoreMarker(paths)).toBeUndefined()
	})
})
