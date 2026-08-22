import { DomainError } from "@hoardodile/shared"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { parentRules, siblingPairs } from "./schema.ts"
import type { TagService } from "./service.ts"
import {
	cleanupTagTestContext,
	createTagTestContext,
	type TagTestContext,
} from "./test-fixture.ts"

describe("tag merge", () => {
	let ctx: TagTestContext
	let svc: TagService
	let dbh: TagTestContext["dbh"]
	let commonCatId: string
	let resCatId: string
	let resId: string
	let resId2: string
	let charId: string

	beforeEach(async () => {
		ctx = await createTagTestContext()
		svc = ctx.svc
		dbh = ctx.dbh
		commonCatId = ctx.commonId
		resCatId = ctx.resCatId
		resId = ctx.resId
		resId2 = ctx.resId2
		charId = ctx.charId
	})

	afterEach(() => {
		cleanupTagTestContext(ctx)
	})

	test("preview reports the usages and rules that would move, without mutating", async () => {
		const source = await svc.create({ name: "src", catId: commonCatId })
		const target = await svc.create({ name: "tgt", catId: commonCatId })
		await svc.attachToResource(resId, source.id)
		await svc.attachToResource(resId2, source.id)
		await svc.attachToCharacter(charId, source.id)
		dbh.db
			.insert(siblingPairs)
			.values({ badId: source.id, goodId: target.id, createdAt: 1 })
			.run()
		dbh.db
			.insert(parentRules)
			.values({ childId: source.id, parentId: target.id, createdAt: 1 })
			.run()

		const preview = await svc.mergePreview(source.id, target.id)
		expect(preview).toEqual({
			sourceId: source.id,
			targetId: target.id,
			resourceCount: 2,
			characterCount: 1,
			siblingRuleCount: 1,
			parentRuleCount: 1,
		})
		// Nothing moved yet.
		expect(await svc.detail(source.id)).toBeDefined()
	})

	test("merge moves usages, migrates rules, deletes the source, and reports", async () => {
		const source = await svc.create({ name: "src", catId: commonCatId })
		const target = await svc.create({ name: "tgt", catId: commonCatId })
		await svc.attachToResource(resId, source.id)
		await svc.attachToCharacter(charId, source.id)
		await svc.attachToResource(resId, target.id) // overlap: must not double-count
		dbh.db
			.insert(siblingPairs)
			.values({ badId: source.id, goodId: target.id, createdAt: 1 })
			.run()
		dbh.db
			.insert(parentRules)
			.values({ childId: source.id, parentId: target.id, createdAt: 1 })
			.run()

		const result = await svc.merge(source.id, target.id)
		expect(result).toEqual({
			targetId: target.id,
			movedResources: 1,
			movedCharacters: 1,
			movedSiblingRules: 0,
			movedParentRules: 1,
		})

		await expect(svc.detail(source.id)).rejects.toThrow(DomainError)
		const resTags = await svc.listForResource(resId)
		expect(resTags.map((t) => t.id)).toEqual([target.id])
		const charTags = await svc.listForCharacter(charId)
		expect(charTags.map((t) => t.id)).toEqual([target.id])
		const pairs = dbh.db.select().from(siblingPairs).all()
		expect(pairs).toHaveLength(0)
		// The `s → t` rule repoints to the meaningless self-loop `t → t`
		// and is dropped with it.
		const rules = dbh.db.select().from(parentRules).all()
		expect(rules).toHaveLength(0)
	})

	test("merge absorbs the source's sibling group into the target group (group union)", async () => {
		const a = await svc.create({ name: "a", catId: commonCatId })
		const s = await svc.create({ name: "s", catId: commonCatId })
		const b = await svc.create({ name: "b", catId: commonCatId })
		const t = await svc.create({ name: "t", catId: commonCatId })
		// Group {s, a, b} with display b; group {t} alone.
		dbh.db
			.insert(siblingPairs)
			.values([
				{ badId: a.id, goodId: s.id, createdAt: 1 },
				{ badId: s.id, goodId: b.id, createdAt: 1 },
			])
			.run()

		const result = await svc.merge(s.id, t.id)
		expect(result.movedSiblingRules).toBe(2)
		const pairs = dbh.db.select().from(siblingPairs).all()
		expect(pairs.map((p) => ({ badId: p.badId, goodId: p.goodId }))).toEqual([
			{ badId: a.id, goodId: t.id },
			{ badId: b.id, goodId: t.id },
		])
	})

	test("merge that would create a parent-rule cycle is blocked and rolls back", async () => {
		const a = await svc.create({ name: "a", catId: commonCatId })
		const s = await svc.create({ name: "s", catId: commonCatId })
		const b = await svc.create({ name: "b", catId: commonCatId })
		await svc.attachToResource(resId, s.id)
		// a → s and b → a: merging s into b would close the cycle b → a → b.
		dbh.db
			.insert(parentRules)
			.values([
				{ childId: a.id, parentId: s.id, createdAt: 1 },
				{ childId: b.id, parentId: a.id, createdAt: 1 },
			])
			.run()

		await expect(svc.merge(s.id, b.id)).rejects.toMatchObject({
			kind: "tag.merge.creates_cycle",
		})
		// Transaction rolled back: source survives, usage untouched.
		await expect(svc.detail(s.id)).resolves.toBeDefined()
		expect((await svc.listForResource(resId)).map((t) => t.id)).toEqual([s.id])
	})

	test("cross-kind merge is rejected in preview and merge", async () => {
		const src = await svc.create({ name: "src", catId: commonCatId })
		const tgt = await svc.create({ name: "tgt", catId: resCatId })
		await expect(svc.mergePreview(src.id, tgt.id)).rejects.toMatchObject({
			kind: "tag.merge.kind_mismatch",
		})
		await expect(svc.merge(src.id, tgt.id)).rejects.toMatchObject({
			kind: "tag.merge.kind_mismatch",
		})
	})

	test("self-merge is rejected", async () => {
		const tag = await svc.create({ name: "only", catId: commonCatId })
		await expect(svc.merge(tag.id, tag.id)).rejects.toMatchObject({
			kind: "tag.merge.same_tag",
		})
	})

	test("merging a missing tag reports NOT_FOUND", async () => {
		const tag = await svc.create({ name: "tgt", catId: commonCatId })
		await expect(svc.merge("missing", tag.id)).rejects.toMatchObject({
			code: "NOT_FOUND",
		})
	})

	test("force-deleting a tag cascades its rules", async () => {
		const bad = await svc.create({ name: "bad", catId: commonCatId })
		const good = await svc.create({ name: "good", catId: commonCatId })
		dbh.db
			.insert(siblingPairs)
			.values({ badId: bad.id, goodId: good.id, createdAt: 1 })
			.run()
		dbh.db
			.insert(parentRules)
			.values({ childId: bad.id, parentId: good.id, createdAt: 1 })
			.run()

		await svc.forceDelete(good.id, "good")
		expect(dbh.db.select().from(siblingPairs).all()).toHaveLength(0)
		expect(dbh.db.select().from(parentRules).all()).toHaveLength(0)
	})
})
