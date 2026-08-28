import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DomainError } from "@hoardodile/shared"
import { createCharacterService } from "src/domain/char/service.ts"
import { createResourceService } from "src/domain/res/service.ts"
import { createTestHooks } from "src/domain/res/test-registry.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createCategoryService } from "../cat/service.ts"
import { createTagService, type TagService } from "./service.ts"

describe("tag service", () => {
	let root: string
	let dbh: DbHandles
	let svc: TagService
	let catId: string
	let resId: string
	let resId2: string
	let charId: string
	let charId2: string

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "app-tag-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
		const paths = createStoragePaths({ root })
		svc = createTagService({
			db: dbh.db,
			paths,
			readOnly: { current: false },
		})

		// Create a real category so FK constraints are satisfied.
		const catSvc = createCategoryService({ db: dbh.db })
		const cat = await catSvc.create({ name: "TestCat", kind: "common" })
		catId = cat.id

		// Create real entities so FK constraints are satisfied.
		const resSvc = createResourceService({
			db: dbh.db,
			paths,
			readOnly: { current: false },
			pluginHooks: createTestHooks(),
		})
		const r = await resSvc.create({ name: "test-resource" })
		resId = r.id
		const r2 = await resSvc.create({ name: "test-resource-2" })
		resId2 = r2.id

		const charSvc = createCharacterService({
			db: dbh.db,
			paths,
			readOnly: { current: false },
		})
		const c = await charSvc.create({ name: "test-character" })
		charId = c.id
		const c2 = await charSvc.create({ name: "test-character-2" })
		charId2 = c2.id
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("create and list tags", async () => {
		const t = await svc.create({ name: "Adventure", catId: catId })
		expect(t.id).toBeTruthy()
		expect(t.name).toBe("Adventure")
		expect(t.intro).toBe("")
		expect(t.color).toBe("")
		expect(t.position).toBe(0)
		expect(t.pinned).toBe(false)
		expect(t.catId).toBe(catId)
		expect(await svc.listAll()).toHaveLength(1)
	})

	test("update tag fields", async () => {
		const t = await svc.create({ name: "OldName", catId: catId })
		const updated = await svc.update({
			id: t.id,
			name: "NewName",
			color: "#ff0000",
		})
		expect(updated.name).toBe("NewName")
		expect(updated.color).toBe("#ff0000")
	})

	test("delete removes the tag", async () => {
		const t = await svc.create({ name: "ToDelete", catId: catId })
		await svc.delete(t.id)
		await expect(svc.detail(t.id)).rejects.toThrow(DomainError)
	})

	test("detail throws NOT_FOUND for missing id", async () => {
		await expect(svc.detail("nonexistent")).rejects.toThrow(DomainError)
	})

	// resource attach/detach

	test("attach tag to resource -- idempotent", async () => {
		const tag = await svc.create({ name: "Tag", catId: catId })
		// Idempotent: attach twice should not throw
		await svc.attachToResource(resId, tag.id)
		await svc.attachToResource(resId, tag.id)
		expect((await svc.listForResource(resId)).map((t) => t.id)).toEqual([
			tag.id,
		])
	})

	test("detach tag from resource", async () => {
		const tag = await svc.create({ name: "Tag", catId: catId })
		await svc.attachToResource(resId, tag.id)
		await svc.detachFromResource(resId, tag.id)
		expect(await svc.listForResource(resId)).toHaveLength(0)
	})

	test("cascade: deleting tag removes resource join", async () => {
		const tag = await svc.create({ name: "CascadeTag", catId: catId })
		await svc.attachToResource(resId, tag.id)
		await svc.forceDelete(tag.id, "CascadeTag")
		expect(await svc.listForResource(resId)).toHaveLength(0)
	})

	// character attach/detach

	test("attach and detach tag from character", async () => {
		const tag = await svc.create({ name: "CharTag", catId: catId })
		await svc.attachToCharacter(charId, tag.id)
		expect((await svc.listForCharacter(charId)).map((t) => t.id)).toEqual([
			tag.id,
		])
		await svc.detachFromCharacter(charId, tag.id)
		expect(await svc.listForCharacter(charId)).toHaveLength(0)
	})

	test("reorder repacks positions 0..n-1 per category bucket", async () => {
		const a = await svc.create({ name: "A", catId: catId })
		const b = await svc.create({ name: "B", catId: catId })
		const c = await svc.create({ name: "C", catId: catId })
		await svc.reorder(catId, [c.id, a.id, b.id])
		expect((await svc.detail(c.id)).position).toBe(0)
		expect((await svc.detail(a.id)).position).toBe(1)
		expect((await svc.detail(b.id)).position).toBe(2)
	})

	test("reorder rejects mismatched ids list", async () => {
		const a = await svc.create({ name: "A", catId: catId })
		await svc.create({ name: "B", catId: catId })
		await expect(svc.reorder(catId, [a.id])).rejects.toThrow(DomainError)
	})

	// ── bulk attach / detach ─────────────────────────────────────────────────

	test("bulkAttachToResource attaches tag to multiple resources", async () => {
		const tag = await svc.create({ name: "BulkResTag", catId: catId })
		await svc.bulkAttachToResource([resId, resId2], tag.id)
		const r1Tags = await svc.listForResource(resId)
		const r2Tags = await svc.listForResource(resId2)
		expect(r1Tags.map((t) => t.id)).toEqual([tag.id])
		expect(r2Tags.map((t) => t.id)).toEqual([tag.id])
	})

	test("bulkAttachToResource is idempotent", async () => {
		const tag = await svc.create({ name: "BulkResTag", catId: catId })
		await svc.bulkAttachToResource([resId, resId2], tag.id)
		await svc.bulkAttachToResource([resId, resId2], tag.id)
		expect((await svc.listForResource(resId)).map((t) => t.id)).toEqual([
			tag.id,
		])
	})

	test("bulkDetachFromResource removes tag from multiple resources", async () => {
		const tag = await svc.create({ name: "BulkResTag", catId: catId })
		await svc.bulkAttachToResource([resId, resId2], tag.id)
		await svc.bulkDetachFromResource([resId, resId2], tag.id)
		expect(await svc.listForResource(resId)).toHaveLength(0)
		expect(await svc.listForResource(resId2)).toHaveLength(0)
	})

	test("bulkDetachFromResource is idempotent", async () => {
		const tag = await svc.create({ name: "BulkResTag", catId: catId })
		await svc.bulkDetachFromResource([resId, resId2], tag.id)
		expect(await svc.listForResource(resId)).toHaveLength(0)
		expect(await svc.listForResource(resId2)).toHaveLength(0)
	})

	test("bulkAttachToCharacter attaches tag to multiple characters", async () => {
		const tag = await svc.create({ name: "BulkCharTag", catId: catId })
		await svc.bulkAttachToCharacter([charId, charId2], tag.id)
		const c1Tags = await svc.listForCharacter(charId)
		const c2Tags = await svc.listForCharacter(charId2)
		expect(c1Tags.map((t) => t.id)).toEqual([tag.id])
		expect(c2Tags.map((t) => t.id)).toEqual([tag.id])
	})

	test("bulkDetachFromCharacter removes tag from multiple characters", async () => {
		const tag = await svc.create({ name: "BulkCharTag", catId: catId })
		await svc.bulkAttachToCharacter([charId, charId2], tag.id)
		await svc.bulkDetachFromCharacter([charId, charId2], tag.id)
		expect(await svc.listForCharacter(charId)).toHaveLength(0)
		expect(await svc.listForCharacter(charId2)).toHaveLength(0)
	})

	test("bulk operations with empty ids are no-ops", async () => {
		const tag = await svc.create({ name: "NoOpTag", catId: catId })
		await svc.bulkAttachToResource([], tag.id)
		await svc.bulkDetachFromResource([], tag.id)
		await svc.bulkAttachToCharacter([], tag.id)
		await svc.bulkDetachFromCharacter([], tag.id)
		expect(await svc.listForResource(resId)).toHaveLength(0)
		expect(await svc.listForCharacter(charId)).toHaveLength(0)
	})

	// ── repo batch list ────────────────────────────────────────────────────────

	test("listForManyResources returns all tag links for given ids", async () => {
		const { buildTagRepository } = await import("./repo.ts")
		const repo = buildTagRepository(dbh.db)
		const tagA = await svc.create({ name: "A", catId: catId })
		const tagB = await svc.create({ name: "B", catId: catId })
		await svc.bulkAttachToResource([resId, resId2], tagA.id)
		await svc.bulkAttachToResource([resId2], tagB.id)

		const rows = repo.listForManyResources([resId, resId2])
		const mapped = rows.map((r) => [r.resId, r.tagId])
		expect(mapped).toContainEqual([resId, tagA.id])
		expect(mapped).toContainEqual([resId2, tagA.id])
		expect(mapped).toContainEqual([resId2, tagB.id])
		expect(rows).toHaveLength(3)
	})

	test("listForManyResources returns empty for empty ids", async () => {
		const { buildTagRepository } = await import("./repo.ts")
		const repo = buildTagRepository(dbh.db)
		expect(repo.listForManyResources([])).toHaveLength(0)
	})

	test("listForManyCharacters returns all tag links for given ids", async () => {
		const { buildTagRepository } = await import("./repo.ts")
		const repo = buildTagRepository(dbh.db)
		const tagA = await svc.create({ name: "A", catId: catId })
		const tagB = await svc.create({ name: "B", catId: catId })
		await svc.bulkAttachToCharacter([charId, charId2], tagA.id)
		await svc.bulkAttachToCharacter([charId2], tagB.id)

		const rows = repo.listForManyCharacters([charId, charId2])
		const mapped = rows.map((r) => [r.charId, r.tagId])
		expect(mapped).toContainEqual([charId, tagA.id])
		expect(mapped).toContainEqual([charId2, tagA.id])
		expect(mapped).toContainEqual([charId2, tagB.id])
		expect(rows).toHaveLength(3)
	})

	test("attach updates resource updatedAt", async () => {
		const resSvc = createResourceService({
			db: dbh.db,
			paths: createStoragePaths({ root }),
			readOnly: { current: false },
			pluginHooks: createTestHooks(),
		})
		const before = (await resSvc.detail(resId)).updatedAt
		await new Promise((r) => setTimeout(r, 5))
		const tag = await svc.create({ name: "ResTsTag", catId: catId })
		await svc.attachToResource(resId, tag.id)
		const after = (await resSvc.detail(resId)).updatedAt
		expect(after).toBeGreaterThan(before)
	})

	test("detach updates character updatedAt", async () => {
		const charSvc = createCharacterService({
			db: dbh.db,
			paths: createStoragePaths({ root }),
			readOnly: { current: false },
		})
		const tag = await svc.create({ name: "CharTsTag", catId: catId })
		await svc.attachToCharacter(charId, tag.id)
		const before = (await charSvc.detail(charId)).updatedAt
		await new Promise((r) => setTimeout(r, 5))
		await svc.detachFromCharacter(charId, tag.id)
		const after = (await charSvc.detail(charId)).updatedAt
		expect(after).toBeGreaterThan(before)
	})

	test("create rejects a duplicate (namespace, name) — trim, exact", async () => {
		const first = await svc.create({ name: "Adventure", catId: catId })
		await expect(
			svc.create({ name: " Adventure ", catId: catId }),
		).rejects.toMatchObject({
			kind: "tag.name_exists",
			details: { catId, name: "Adventure", existingId: first.id },
		})
	})

	test("the same name is fine in another namespace", async () => {
		const catSvc = createCategoryService({ db: dbh.db })
		const other = await catSvc.create({ name: "Other", kind: "common" })
		await expect(
			svc.create({ name: "Adventure", catId: other.id }),
		).resolves.toBeDefined()
	})

	test("rename onto an existing tag name is rejected and carries the colliding id", async () => {
		await svc.create({ name: "Hero", catId: catId })
		const other = await svc.create({ name: "Villain", catId: catId })
		await expect(
			svc.update({ id: other.id, name: "Hero" }),
		).rejects.toMatchObject({
			kind: "tag.name_exists",
			details: expect.objectContaining({ existingId: expect.any(String) }),
		})
		// Renaming to the tag's own trimmed name stays allowed.
		await expect(
			svc.update({ id: other.id, name: " Villain " }),
		).resolves.toMatchObject({ name: " Villain " })
	})

	test("moving a tag into a namespace with a same-name tag is rejected", async () => {
		const catSvc = createCategoryService({ db: dbh.db })
		const other = await catSvc.create({ name: "Other", kind: "common" })
		await svc.create({ name: "Hero", catId: catId })
		const twin = await svc.create({ name: "Hero", catId: other.id })
		await expect(
			svc.update({ id: twin.id, catId: catId }),
		).rejects.toMatchObject({ kind: "tag.name_exists" })
	})
})
