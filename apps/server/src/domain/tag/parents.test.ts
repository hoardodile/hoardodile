import { afterEach, beforeEach, describe, expect, test } from "vitest"
import type { TagService } from "./service.ts"
import {
	cleanupTagTestContext,
	createTagTestContext,
	type TagTestContext,
} from "./test-fixture.ts"

describe("parent rules (M3)", () => {
	let ctx: TagTestContext
	let svc: TagService
	let commonId: string
	let resCatId: string
	let charCatId: string
	let resId: string
	let resId2: string

	beforeEach(async () => {
		ctx = await createTagTestContext()
		svc = ctx.svc
		commonId = ctx.commonId
		resCatId = ctx.resCatId
		charCatId = ctx.charCatId
		resId = ctx.resId
		resId2 = ctx.resId2
	})

	afterEach(() => {
		cleanupTagTestContext(ctx)
	})

	test("creating and listing parent rules", async () => {
		const child = await svc.create({ name: "child", catId: commonId })
		const parent = await svc.create({ name: "parent", catId: commonId })
		await svc.parentRuleCreate({ childId: child.id, parentId: parent.id })
		expect(await svc.parentRules()).toEqual([
			{ childKind: "tag", childId: child.id, parentId: parent.id },
		])
	})

	test("a self-rule and a cycle are rejected", async () => {
		const a = await svc.create({ name: "a", catId: commonId })
		const b = await svc.create({ name: "b", catId: commonId })
		await expect(
			svc.parentRuleCreate({ childId: a.id, parentId: a.id }),
		).rejects.toMatchObject({ kind: "tag.parent_rule.self" })
		await svc.parentRuleCreate({ childId: a.id, parentId: b.id })
		await expect(
			svc.parentRuleCreate({ childId: b.id, parentId: a.id }),
		).rejects.toMatchObject({ kind: "tag.parent_rule.cycle" })
	})

	test("chains are allowed; kind bridges are rejected", async () => {
		const a = await svc.create({ name: "a", catId: commonId })
		const b = await svc.create({ name: "b", catId: commonId })
		const c = await svc.create({ name: "c", catId: commonId })
		await svc.parentRuleCreate({ childId: a.id, parentId: b.id })
		await expect(
			svc.parentRuleCreate({ childId: b.id, parentId: c.id }),
		).resolves.toBeUndefined()

		// resource → common → character chain is a kind bridge.
		const res = await svc.create({ name: "res", catId: resCatId })
		const common = await svc.create({ name: "common", catId: commonId })
		const char = await svc.create({ name: "char", catId: charCatId })
		await svc.parentRuleCreate({ childId: res.id, parentId: common.id })
		await expect(
			svc.parentRuleCreate({ childId: common.id, parentId: char.id }),
		).rejects.toMatchObject({ kind: "tag.parent_rule.kind_isolation" })
	})

	test("removing a rule makes the virtual tag disappear", async () => {
		const child = await svc.create({ name: "child", catId: commonId })
		const parent = await svc.create({ name: "parent", catId: commonId })
		await svc.parentRuleCreate({ childId: child.id, parentId: parent.id })
		await svc.attachToResource(resId, child.id)
		expect((await svc.listForResource(resId)).map((t) => t.id)).toEqual([
			child.id,
			parent.id,
		])

		await svc.parentRuleRemove({ childId: child.id, parentId: parent.id })
		expect((await svc.listForResource(resId)).map((t) => t.id)).toEqual([
			child.id,
		])
	})

	test("virtual parents chain transitively and are flagged", async () => {
		const a = await svc.create({ name: "a", catId: commonId })
		const b = await svc.create({ name: "b", catId: commonId })
		const c = await svc.create({ name: "c", catId: commonId })
		await svc.parentRuleCreate({ childId: a.id, parentId: b.id })
		await svc.parentRuleCreate({ childId: b.id, parentId: c.id })
		await svc.attachToResource(resId, a.id)

		const tags = await svc.listForResource(resId)
		expect(tags.map((t) => t.id)).toEqual([a.id, b.id, c.id])
		expect(tags.find((t) => t.id === b.id)?.virtual).toBe(true)
		expect(tags.find((t) => t.id === c.id)?.virtual).toBe(true)
		expect(tags.find((t) => t.id === a.id)?.virtual).toBeUndefined()
	})

	test("a parent rule on any sibling member applies to the whole group", async () => {
		const member = await svc.create({ name: "member", catId: commonId })
		const display = await svc.create({ name: "display", catId: commonId })
		const parent = await svc.create({ name: "parent", catId: commonId })
		await svc.siblingRuleCreate({ badId: member.id, goodId: display.id })
		await svc.parentRuleCreate({ childId: member.id, parentId: parent.id })
		await svc.attachToResource(resId, member.id)

		const tags = await svc.listForResource(resId)
		expect(tags.map((t) => t.id)).toEqual([display.id, parent.id])
		expect(tags.find((t) => t.id === parent.id)?.virtual).toBe(true)
	})

	test("virtual parents never reach counts or cards", async () => {
		const child = await svc.create({ name: "child", catId: commonId })
		const parent = await svc.create({ name: "parent", catId: commonId })
		await svc.parentRuleCreate({ childId: child.id, parentId: parent.id })
		await svc.attachToResource(resId, child.id)

		const resSvc = ctx.resSvc

		const { rows } = await resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
		})
		const card = rows.find((r) => r.id === resId)
		expect(card?.pinnedTags.map((t) => t.id)).toEqual([])
		const groups = await svc.siblingGroups()
		expect(groups).toEqual([])
	})

	test("search: parent matches descendants, child does not match parents", async () => {
		const child = await svc.create({ name: "child", catId: commonId })
		const parent = await svc.create({ name: "parent", catId: commonId })
		await svc.parentRuleCreate({ childId: child.id, parentId: parent.id })
		await svc.attachToResource(resId, child.id)
		await svc.attachToResource(resId2, parent.id)

		const resSvc = ctx.resSvc

		const listCards = (tagIds: readonly string[], tagMode: string) =>
			resSvc.listCards({
				query: undefined,
				page: 1,
				size: 50,
				tagIds,
				tagMode: tagMode as never,
			})

		// Searching the parent matches both the parent entry and the
		// descendant's entry.
		const byParent = await listCards([parent.id], "or")
		expect(byParent.rows.map((r) => r.id).sort()).toEqual(
			[resId, resId2].sort(),
		)
		// Searching the child matches only the child entry.
		const byChild = await listCards([child.id], "or")
		expect(byChild.rows.map((r) => r.id)).toEqual([resId])
		// NOT parent excludes both entries.
		const excluded = await listCards([parent.id], "not")
		expect(excluded.rows).toHaveLength(0)
	})

	test("multi-level search: selecting the top parent matches everything", async () => {
		const a = await svc.create({ name: "a", catId: commonId })
		const b = await svc.create({ name: "b", catId: commonId })
		const c = await svc.create({ name: "c", catId: commonId })
		await svc.parentRuleCreate({ childId: a.id, parentId: b.id })
		await svc.parentRuleCreate({ childId: b.id, parentId: c.id })
		await svc.attachToResource(resId, a.id)
		await svc.attachToResource(resId2, b.id)

		const resSvc = ctx.resSvc

		const { rows } = await resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
			tagIds: [c.id],
			tagMode: "or",
		})
		expect(rows.map((r) => r.id).sort()).toEqual([resId, resId2].sort())
	})

	test("force-deleting a tag cascades its parent rules", async () => {
		const child = await svc.create({ name: "child", catId: commonId })
		const parent = await svc.create({ name: "parent", catId: commonId })
		await svc.parentRuleCreate({ childId: child.id, parentId: parent.id })
		await svc.forceDelete(child.id, "child")
		expect(await svc.parentRules()).toEqual([])
	})

	test("re-creating the same character rule is a no-op", async () => {
		const parent = await svc.create({ name: "parent", catId: commonId })
		// The character rule's PK row has a NULL `child_id`, so SQLite's
		// unique index cannot reject the duplicate — the service must.
		await svc.parentRuleCreate({
			childKind: "character",
			childId: ctx.charId,
			parentId: parent.id,
		})
		await svc.parentRuleCreate({
			childKind: "character",
			childId: ctx.charId,
			parentId: parent.id,
		})
		expect(await svc.parentRules()).toEqual([
			{ childKind: "character", childId: ctx.charId, parentId: parent.id },
		])
	})
})
