import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DomainError } from "@hoardodile/shared"
import { systemPreferences } from "src/domain/prefs/schema.ts"
import { createResourceService } from "src/domain/res/service.ts"
import { createTestHooks } from "src/domain/res/test-registry.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createTagService } from "../tag/service.ts"
import { WATCH_ONLY_PREF_KEY } from "../tag/visibility.ts"
import { type CatService, createCategoryService } from "./service.ts"

describe("category service", () => {
	let dbh: DbHandles
	let svc: CatService
	let root: string
	let paths: ReturnType<typeof createStoragePaths>

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-cat-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
		paths = createStoragePaths({ root })
		svc = createCategoryService({ db: dbh.db })
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	function makeTagSvc() {
		return createTagService({
			db: dbh.db,
			paths,
			readOnly: { current: false },
		})
	}

	function setWatchOnly(on: boolean): void {
		dbh.db
			.insert(systemPreferences)
			.values({
				key: WATCH_ONLY_PREF_KEY,
				scope: "sync",
				value: on ? "1" : "0",
				updatedAt: Date.now(),
			})
			.onConflictDoUpdate({
				target: systemPreferences.key,
				set: { value: on ? "1" : "0", updatedAt: Date.now() },
			})
			.run()
	}

	async function createRes(name: string): Promise<string> {
		const resSvc = createResourceService({
			db: dbh.db,
			paths,
			readOnly: { current: false },
			pluginHooks: createTestHooks(),
		})
		const r = await resSvc.create({ name })
		return r.id
	}

	test("create category", async () => {
		const c = await svc.create({ name: "Root", kind: "common" })
		expect(c.id).toBeTruthy()
		expect(c.name).toBe("Root")
		expect(c.pinned).toBe(false)
		expect(c.position).toBe(0)
	})

	test("listAll returns all categories", async () => {
		await svc.create({ name: "A", kind: "common" })
		await svc.create({ name: "B", kind: "common" })
		expect(await svc.listAll()).toHaveLength(2)
	})

	test("update renames and changes position", async () => {
		const c = await svc.create({ name: "Old", kind: "common" })
		const updated = await svc.update({ id: c.id, name: "New", position: 5 })
		expect(updated.name).toBe("New")
		expect(updated.position).toBe(5)
	})

	test("delete removes the category", async () => {
		const c = await svc.create({ name: "ToDelete", kind: "common" })
		await svc.delete(c.id)
		await expect(svc.detail(c.id)).rejects.toThrow(DomainError)
	})

	test("delete blocked when category has tags", async () => {
		const tagSvc = makeTagSvc()
		const c = await svc.create({ name: "Has Tags", kind: "common" })
		await tagSvc.create({ name: "T1", catId: c.id })
		await expect(svc.delete(c.id)).rejects.toThrow(DomainError)
	})

	test("forceDelete removes even with tags when name confirmed", async () => {
		const tagSvc = makeTagSvc()
		const c = await svc.create({ name: "Force Me", kind: "common" })
		await tagSvc.create({ name: "T1", catId: c.id })
		await svc.forceDelete(c.id, c.name)
		await expect(svc.detail(c.id)).rejects.toThrow(DomainError)
	})

	test("listAllWithCounts returns tag counts", async () => {
		const tagSvc = makeTagSvc()
		const a = await svc.create({ name: "A", kind: "common" })
		const b = await svc.create({ name: "B", kind: "common" })
		await tagSvc.create({ name: "T1", catId: a.id })
		await tagSvc.create({ name: "T2", catId: a.id })
		const rows = await svc.listAllWithCounts()
		const byId = new Map(rows.map((r) => [r.id, r]))
		expect(byId.get(a.id)?.tagCount).toBe(2)
		expect(byId.get(b.id)?.tagCount).toBe(0)
	})

	test("detail throws NOT_FOUND for missing id", async () => {
		await expect(svc.detail("nonexistent")).rejects.toThrow(DomainError)
	})

	test("create rejects a duplicate namespace name (trim, exact)", async () => {
		const first = await svc.create({ name: "Music", kind: "common" })
		await expect(
			svc.create({ name: " Music ", kind: "resource" }),
		).rejects.toMatchObject({
			kind: "category.name_exists",
			details: { name: "Music", existingId: first.id },
		})
	})

	test("rename onto an existing namespace name is rejected", async () => {
		await svc.create({ name: "Music", kind: "common" })
		const other = await svc.create({ name: "Books", kind: "common" })
		await expect(
			svc.update({ id: other.id, name: "Music" }),
		).rejects.toMatchObject({ kind: "category.name_exists" })
		// Renaming a category to its own trimmed name stays allowed.
		await expect(
			svc.update({ id: other.id, name: " Books " }),
		).resolves.toMatchObject({ name: " Books " })
	})

	test("case-sensitive names coexist", async () => {
		await svc.create({ name: "Music", kind: "common" })
		await expect(
			svc.create({ name: "music", kind: "common" }),
		).resolves.toBeDefined()
	})

	test("reorder repacks positions 0..n-1", async () => {
		const a = await svc.create({ name: "A", kind: "common", position: 0 })
		const b = await svc.create({ name: "B", kind: "common", position: 1 })
		const c = await svc.create({ name: "C", kind: "common", position: 2 })
		await svc.reorder("common", [c.id, a.id, b.id])
		expect((await svc.detail(c.id)).position).toBe(0)
		expect((await svc.detail(a.id)).position).toBe(1)
		expect((await svc.detail(b.id)).position).toBe(2)
	})

	test("reorder rejects mismatched ids list", async () => {
		const a = await svc.create({ name: "A", kind: "common", position: 0 })
		await svc.create({ name: "B", kind: "common", position: 1 })
		await expect(svc.reorder("common", [a.id])).rejects.toThrow(DomainError)
	})

	test("with watch-only on, listAll/WithCounts narrow to categories with visible tags only", async () => {
		const tagSvc = makeTagSvc()
		const mediaCat = await svc.create({ name: "Media", kind: "resource" })
		const otherCat = await svc.create({ name: "Other", kind: "resource" })
		const watch = await tagSvc.create({
			name: "Focus",
			catId: mediaCat.id,
			visibility: "watch_only",
		})
		await tagSvc.create({ name: "Plain", catId: otherCat.id })
		await tagSvc.attachToResource(await createRes("r1"), watch.id)

		setWatchOnly(true)

		const rows = await svc.listAllWithCounts()
		const byId = new Map(rows.map((r) => [r.id, r]))
		expect(byId.get(mediaCat.id)).toMatchObject({ tagCount: 1 })
		expect(byId.get(otherCat.id)).toBeUndefined()

		const names = (await svc.listAll()).map((c) => c.name)
		expect(names).toContain("Media")
		expect(names).not.toContain("Other")
	})

	test("with watch-only off, listAll/WithCounts are not narrowed", async () => {
		const tagSvc = makeTagSvc()
		const mediaCat = await svc.create({ name: "Media2", kind: "resource" })
		const otherCat = await svc.create({ name: "Other2", kind: "resource" })
		const watch = await tagSvc.create({
			name: "Focus2",
			catId: mediaCat.id,
			visibility: "watch_only",
		})
		await tagSvc.create({ name: "Plain2", catId: otherCat.id })
		await tagSvc.attachToResource(await createRes("r2"), watch.id)

		expect((await svc.listAll()).map((c) => c.name).sort()).toEqual([
			"Media2",
			"Other2",
		])
		const byId = new Map((await svc.listAllWithCounts()).map((r) => [r.id, r]))
		expect(byId.get(otherCat.id)?.tagCount).toBe(1)
	})
})
