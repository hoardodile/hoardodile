import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createCategoryService } from "../cat/service.ts"
import { siblingPairs } from "./schema.ts"
import type { TagService } from "./service.ts"
import {
	cleanupTagTestContext,
	createTagTestContext,
	type TagTestContext,
} from "./test-fixture.ts"

describe("sibling rules (M2)", () => {
	let ctx: TagTestContext
	let svc: TagService
	let dbh: TagTestContext["dbh"]
	let commonId: string
	let resCatId: string
	let charCatId: string
	let resId: string
	let resId2: string
	let charId: string

	beforeEach(async () => {
		ctx = await createTagTestContext()
		svc = ctx.svc
		dbh = ctx.dbh
		commonId = ctx.commonId
		resCatId = ctx.resCatId
		charCatId = ctx.charCatId
		resId = ctx.resId
		resId2 = ctx.resId2
		charId = ctx.charId
	})

	afterEach(() => {
		cleanupTagTestContext(ctx)
	})

	function pairRows() {
		return dbh.db
			.select()
			.from(siblingPairs)
			.all()
			.map((p) => [p.badId, p.goodId])
	}

	test("creating a pair reports it as a sibling group with union counts", async () => {
		const bad = await svc.create({ name: "bad", catId: commonId })
		const good = await svc.create({ name: "good", catId: commonId })
		await svc.attachToResource(resId, bad.id)
		await svc.attachToResource(resId2, bad.id)
		await svc.attachToResource(resId, good.id)
		await svc.attachToCharacter(charId, good.id)

		await svc.siblingRuleCreate({ badId: bad.id, goodId: good.id })
		const groups = await svc.siblingGroups()
		expect(groups).toHaveLength(1)
		expect(groups[0]).toEqual({
			displayTagId: good.id,
			memberTagIds: expect.arrayContaining([bad.id, good.id]),
			memberCharacters: [],
			resCount: 2,
			charCount: 1,
		})
	})

	test("a cycle is rejected", async () => {
		const a = await svc.create({ name: "a", catId: commonId })
		const b = await svc.create({ name: "b", catId: commonId })
		await svc.siblingRuleCreate({ badId: a.id, goodId: b.id })
		await expect(
			svc.siblingRuleCreate({ badId: b.id, goodId: a.id }),
		).rejects.toMatchObject({ kind: "tag.sibling_pair.cycle" })
	})

	test("a self-pair is rejected", async () => {
		const a = await svc.create({ name: "a", catId: commonId })
		await expect(
			svc.siblingRuleCreate({ badId: a.id, goodId: a.id }),
		).rejects.toMatchObject({ kind: "tag.sibling_pair.same_tag" })
	})

	test("common bridges resource and character — rejected", async () => {
		const res = await svc.create({ name: "res", catId: resCatId })
		const common = await svc.create({ name: "common", catId: commonId })
		const char = await svc.create({ name: "char", catId: charCatId })
		await svc.siblingRuleCreate({ badId: res.id, goodId: common.id })
		await expect(
			svc.siblingRuleCreate({ badId: char.id, goodId: common.id }),
		).rejects.toMatchObject({ kind: "tag.sibling_pair.kind_isolation" })
	})

	test("common pairs with one kind freely", async () => {
		const res = await svc.create({ name: "res", catId: resCatId })
		const common = await svc.create({ name: "common", catId: commonId })
		await expect(
			svc.siblingRuleCreate({ badId: res.id, goodId: common.id }),
		).resolves.toBeUndefined()
	})

	test("a tag can be the bad side of only one pair (replacement)", async () => {
		const a = await svc.create({ name: "a", catId: commonId })
		const b = await svc.create({ name: "b", catId: commonId })
		const c = await svc.create({ name: "c", catId: commonId })
		await svc.siblingRuleCreate({ badId: a.id, goodId: b.id })
		await svc.siblingRuleCreate({ badId: a.id, goodId: c.id })
		expect(pairRows()).toEqual([[a.id, c.id]])
	})

	test("removing a pair dissolves the group", async () => {
		const a = await svc.create({ name: "a", catId: commonId })
		const b = await svc.create({ name: "b", catId: commonId })
		await svc.siblingRuleCreate({ badId: a.id, goodId: b.id })
		await svc.siblingRuleRemove(a.id)
		expect(await svc.siblingGroups()).toEqual([])
	})

	test("setting a display rewrites the group as a star", async () => {
		const a = await svc.create({ name: "a", catId: commonId })
		const b = await svc.create({ name: "b", catId: commonId })
		const c = await svc.create({ name: "c", catId: commonId })
		await svc.siblingRuleCreate({ badId: a.id, goodId: b.id })
		await svc.siblingRuleCreate({ badId: b.id, goodId: c.id })
		// display is c; promote b.
		await svc.siblingSetDisplay(b.id)
		expect(pairRows().sort()).toEqual(
			[
				[a.id, b.id],
				[c.id, b.id],
			].sort(),
		)
	})

	test("deleting a display tag re-elects the most-used member", async () => {
		const a = await svc.create({ name: "a", catId: commonId })
		const b = await svc.create({ name: "b", catId: commonId })
		const d = await svc.create({ name: "d", catId: commonId })
		await svc.siblingRuleCreate({ badId: a.id, goodId: d.id })
		await svc.siblingRuleCreate({ badId: b.id, goodId: d.id })
		await svc.attachToResource(resId, b.id)

		await svc.forceDelete(d.id, "d")
		expect(pairRows()).toEqual([[a.id, b.id]])
		const groups = await svc.siblingGroups()
		expect(groups[0]?.displayTagId).toBe(b.id)
	})

	test("deleting a member only shrinks the group", async () => {
		const a = await svc.create({ name: "a", catId: commonId })
		const d = await svc.create({ name: "d", catId: commonId })
		await svc.siblingRuleCreate({ badId: a.id, goodId: d.id })
		await svc.forceDelete(a.id, "a")
		expect(pairRows()).toEqual([])
	})

	test("listAll carries displayTagId for every tag", async () => {
		const bad = await svc.create({ name: "bad", catId: commonId })
		const good = await svc.create({ name: "good", catId: commonId })
		const lone = await svc.create({ name: "lone", catId: commonId })
		await svc.siblingRuleCreate({ badId: bad.id, goodId: good.id })

		const tags = await svc.listAll()
		const byId = new Map(tags.map((t) => [t.id, t]))
		expect(byId.get(bad.id)?.displayTagId).toBe(good.id)
		expect(byId.get(good.id)?.displayTagId).toBe(good.id)
		expect(byId.get(lone.id)?.displayTagId).toBe(lone.id)
	})

	test("listForResource collapses members to the display row", async () => {
		const bad = await svc.create({ name: "bad", catId: commonId })
		const good = await svc.create({ name: "good", catId: commonId })
		await svc.siblingRuleCreate({ badId: bad.id, goodId: good.id })
		// Only the member is attached; the display must still render.
		await svc.attachToResource(resId, bad.id)

		const tags = await svc.listForResource(resId)
		expect(tags.map((t) => t.id)).toEqual([good.id])
	})

	test("filtering by a member matches any group member (or/and/not)", async () => {
		const bad = await svc.create({ name: "bad", catId: commonId })
		const good = await svc.create({ name: "good", catId: commonId })
		await svc.siblingRuleCreate({ badId: bad.id, goodId: good.id })
		await svc.attachToResource(resId, bad.id)
		await svc.attachToResource(resId2, good.id)

		const resSvc = ctx.resSvc

		const listCards = (tagIds: readonly string[], tagMode: string) =>
			resSvc.listCards({
				query: undefined,
				page: 1,
				size: 50,
				tagIds,
				tagMode: tagMode as never,
			})

		const byMember = await listCards([bad.id], "or")
		expect(byMember.rows.map((r) => r.id).sort()).toEqual(
			[resId, resId2].sort(),
		)
		const byDisplay = await listCards([good.id], "or")
		expect(byDisplay.rows.map((r) => r.id).sort()).toEqual(
			[resId, resId2].sort(),
		)
		// NOT bad excludes resources carrying either member.
		const excluded = await listCards([bad.id], "not")
		expect(excluded.rows).toHaveLength(0)
	})

	test("pinnedTags collapse to the display tag on cards", async () => {
		const bad = await svc.create({ name: "bad", catId: commonId, pinned: true })
		const good = await svc.create({ name: "good", catId: commonId })
		await svc.siblingRuleCreate({ badId: bad.id, goodId: good.id })
		await svc.attachToResource(resId, bad.id)

		const resSvc = ctx.resSvc

		const { rows } = await resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
		})
		const card = rows.find((r) => r.id === resId)
		expect(card?.pinnedTags.map((t) => t.id)).toEqual([good.id])
		expect(card?.pinnedTags[0]?.name).toBe("good")
	})

	test("relatedByTags scores sibling groups as one tag", async () => {
		const member = await svc.create({ name: "member", catId: commonId })
		const display = await svc.create({ name: "display", catId: commonId })
		const unrelated = await svc.create({ name: "unrelated", catId: commonId })
		await svc.siblingRuleCreate({ badId: member.id, goodId: display.id })
		await svc.attachToResource(resId, member.id)
		await svc.attachToResource(resId2, display.id)
		const res3 = await ctx.resSvc.create({ name: "r3" })
		await svc.attachToResource(res3.id, unrelated.id)

		const related = await ctx.resSvc.relatedByTags(resId, 10)
		const ids = related.map((r) => r.id)
		// Shares the {member, display} group — related even though the
		// seed only carries the member.
		expect(ids).toContain(resId2)
		// Shares no group — excluded.
		expect(ids).not.toContain(res3.id)
	})

	test("filtering by an unknown or merged-away tag id matches nothing", async () => {
		const missing = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
			tagIds: ["missing-id"],
			tagMode: "or",
		})
		expect(missing.rows).toEqual([])

		const dup = await svc.create({ name: "dup", catId: commonId })
		const keep = await svc.create({ name: "keep", catId: commonId })
		await svc.attachToResource(resId, dup.id)
		await svc.merge(dup.id, keep.id)
		const after = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
			tagIds: [dup.id],
			tagMode: "or",
		})
		expect(after.rows).toEqual([])
	})

	test("moving a display tag to another namespace keeps the group following it", async () => {
		const member = await svc.create({ name: "member", catId: commonId })
		const display = await svc.create({ name: "display", catId: commonId })
		const other = await createCategoryService({
			db: ctx.dbh.db,
		}).create({ name: "Other", kind: "common" })
		await svc.siblingRuleCreate({ badId: member.id, goodId: display.id })

		await svc.update({ id: display.id, catId: other.id })
		const groups = await svc.siblingGroups()
		expect(groups).toHaveLength(1)
		expect(groups[0]?.displayTagId).toBe(display.id)

		// Rendering follows: the collapsed row carries the new namespace.
		await svc.attachToResource(resId, member.id)
		const tags = await svc.listForResource(resId)
		expect(tags.map((t) => t.id)).toEqual([display.id])
		expect(tags[0]?.catId).toBe(other.id)
	})
})
