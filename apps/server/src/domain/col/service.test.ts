import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DomainError } from "@hoardodile/shared"
import { eq } from "drizzle-orm"
import { resources } from "src/domain/res/schema.ts"
import { createResourceService } from "src/domain/res/service.ts"
import { createTestHooks } from "src/domain/res/test-registry.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
	createResourceCollectionService,
	type ResCollectionService,
} from "./service.ts"

describe("resource collection service", () => {
	let root: string
	let dbh: DbHandles
	let svc: ResCollectionService
	let resA: string
	let resB: string
	let resC: string

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "app-collection-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
		const paths = createStoragePaths({ root })
		svc = createResourceCollectionService({ db: dbh.db })

		const resSvc = createResourceService({
			db: dbh.db,
			paths,
			readOnly: { current: false },
			pluginHooks: createTestHooks(),
		})
		resA = (await resSvc.create({ name: "A" })).id
		resB = (await resSvc.create({ name: "B" })).id
		resC = (await resSvc.create({ name: "C" })).id
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("create and detail", async () => {
		const c = await svc.create({ name: "Series" })
		expect(c.id).toBeTruthy()
		expect(c.name).toBe("Series")
		expect(c.intro).toBe("")
		expect(await svc.listAll()).toHaveLength(1)
		expect((await svc.detail(c.id)).name).toBe("Series")
	})

	test("update fields", async () => {
		const c = await svc.create({ name: "Old" })
		const u = await svc.update({ id: c.id, name: "New", color: "#abc" })
		expect(u.name).toBe("New")
		expect(u.color).toBe("#abc")
	})

	test("attach is idempotent and assigns ascending positions", async () => {
		const c = await svc.create({ name: "Set" })
		await svc.attach(c.id, resA)
		await svc.attach(c.id, resA)
		await svc.attach(c.id, resB)
		await svc.attach(c.id, resC)
		const ids = await svc.listResourceIdsIn(c.id)
		expect(ids).toEqual([resA, resB, resC])
	})

	test("detach removes the membership", async () => {
		const c = await svc.create({ name: "Set" })
		await svc.attach(c.id, resA)
		await svc.attach(c.id, resB)
		await svc.detach(c.id, resA)
		expect(await svc.listResourceIdsIn(c.id)).toEqual([resB])
	})

	test("listForResource returns collections containing it", async () => {
		const c1 = await svc.create({ name: "C1" })
		const c2 = await svc.create({ name: "C2" })
		await svc.attach(c1.id, resA)
		await svc.attach(c2.id, resA)
		const list = await svc.listForResource(resA)
		expect(list.map((c) => c.id).sort()).toEqual([c1.id, c2.id].sort())
	})

	test("reorder permutes positions", async () => {
		const c = await svc.create({ name: "Set" })
		await svc.attach(c.id, resA)
		await svc.attach(c.id, resB)
		await svc.attach(c.id, resC)
		await svc.reorderResources(c.id, [resC, resA, resB])
		expect(await svc.listResourceIdsIn(c.id)).toEqual([resC, resA, resB])
	})

	test("reorder rejects mismatched membership", async () => {
		const c = await svc.create({ name: "Set" })
		await svc.attach(c.id, resA)
		await svc.attach(c.id, resB)
		await expect(svc.reorderResources(c.id, [resA])).rejects.toThrow(
			DomainError,
		)
		await expect(svc.reorderResources(c.id, [resA, resC])).rejects.toThrow(
			DomainError,
		)
	})

	test("delete fails when collection has items", async () => {
		const c = await svc.create({ name: "Set" })
		await svc.attach(c.id, resA)
		await expect(svc.delete(c.id)).rejects.toThrow(DomainError)
	})

	test("delete succeeds when empty", async () => {
		const c = await svc.create({ name: "Set" })
		await svc.delete(c.id)
		await expect(svc.detail(c.id)).rejects.toThrow(DomainError)
	})

	test("forceDelete requires matching name", async () => {
		const c = await svc.create({ name: "Set" })
		await svc.attach(c.id, resA)
		await expect(svc.forceDelete(c.id, "Wrong")).rejects.toThrow(DomainError)
		await svc.forceDelete(c.id, "Set")
		await expect(svc.detail(c.id)).rejects.toThrow(DomainError)
	})

	test("listAllWithCounts reports memberships", async () => {
		const c = await svc.create({ name: "Set" })
		await svc.attach(c.id, resA)
		await svc.attach(c.id, resB)
		const all = await svc.listAllWithCounts()
		expect(all.find((x) => x.id === c.id)?.resCount).toBe(2)
	})

	test("attach rejects unknown resource", async () => {
		const c = await svc.create({ name: "Set" })
		await expect(svc.attach(c.id, "no-such-resource")).rejects.toThrow(
			DomainError,
		)
	})

	test("cascade on resource hard-delete", async () => {
		const c = await svc.create({ name: "Set" })
		await svc.attach(c.id, resA)
		dbh.db.delete(resources).where(eq(resources.id, resA)).run()
		expect(await svc.listResourceIdsIn(c.id)).toEqual([])
	})

	test("attach updates resource and collection timestamps", async () => {
		const resSvc = createResourceService({
			db: dbh.db,
			paths: createStoragePaths({ root }),
			readOnly: { current: false },
			pluginHooks: createTestHooks(),
		})
		const c = await svc.create({ name: "Set" })
		const resBefore = (await resSvc.detail(resA)).updatedAt
		const colBefore = (await svc.detail(c.id)).updatedAt
		await new Promise((r) => setTimeout(r, 5))
		await svc.attach(c.id, resA)
		const resAfter = (await resSvc.detail(resA)).updatedAt
		const colAfter = (await svc.detail(c.id)).updatedAt
		expect(resAfter).toBeGreaterThan(resBefore)
		expect(colAfter).toBeGreaterThan(colBefore)
	})

	test("reorderResources updates collection timestamp", async () => {
		const c = await svc.create({ name: "Set" })
		await svc.attach(c.id, resA)
		await svc.attach(c.id, resB)
		const before = (await svc.detail(c.id)).updatedAt
		await new Promise((r) => setTimeout(r, 5))
		await svc.reorderResources(c.id, [resB, resA])
		const after = (await svc.detail(c.id)).updatedAt
		expect(after).toBeGreaterThan(before)
	})
})
