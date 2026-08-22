import { eq } from "drizzle-orm"
import { categories } from "src/domain/cat/schema.ts"
import { resources } from "src/domain/res/schema.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { siblingPairs, tags as tagsTable } from "./schema.ts"
import type { TagService } from "./service.ts"
import {
	cleanupTagTestContext,
	createTagTestContext,
	type TagTestContext,
} from "./test-fixture.ts"

/**
 * Character entities as rule endpoints: character sibling links (a
 * character links to a display tag) and character parent-rule children
 * (resources linked to the character virtually carry the parent), plus
 * the virtual-tag projection and the pinned-tag pipeline (F2).
 */
describe("character rules", () => {
	let ctx: TagTestContext
	let svc: TagService
	let commonId: string
	let resCatId: string
	let charCatId: string
	let resId: string
	let resId2: string
	let charId: string

	beforeEach(async () => {
		ctx = await createTagTestContext()
		svc = ctx.svc
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

	test("a character links to a tag; groups list it as a member", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		const groups = await svc.siblingGroups()
		expect(groups).toHaveLength(1)
		expect(groups[0]).toMatchObject({
			displayTagId: display.id,
			memberTagIds: [display.id],
			memberCharacters: [{ id: charId, name: "c1" }],
		})
		await svc.siblingRuleRemove(charId, "character")
		expect(await svc.siblingGroups()).toEqual([])
	})

	test("a character link resolves through the group's tag chain", async () => {
		const member = await svc.create({ name: "member", catId: commonId })
		const display = await svc.create({ name: "display", catId: commonId })
		await svc.siblingRuleCreate({ badId: member.id, goodId: display.id })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: member.id,
		})
		const groups = await svc.siblingGroups()
		expect(groups).toHaveLength(1)
		expect(groups[0]).toMatchObject({
			displayTagId: display.id,
			memberTagIds: expect.arrayContaining([display.id, member.id]),
			memberCharacters: [{ id: charId, name: "c1" }],
		})
	})

	test("kind isolation: a character is a character-kind member", async () => {
		const resTag = await svc.create({ name: "res", catId: resCatId })
		const charTag = await svc.create({ name: "char", catId: charCatId })
		const common = await svc.create({ name: "common", catId: commonId })
		await expect(
			svc.siblingRuleCreate({
				badKind: "character",
				badId: charId,
				goodId: resTag.id,
			}),
		).rejects.toMatchObject({ kind: "tag.sibling_pair.kind_isolation" })
		await expect(
			svc.siblingRuleCreate({
				badKind: "character",
				badId: charId,
				goodId: charTag.id,
			}),
		).resolves.toBeUndefined()
		await expect(
			svc.siblingRuleCreate({
				badKind: "character",
				badId: charId,
				goodId: common.id,
			}),
		).resolves.toBeUndefined()
	})

	test("a resource linked to the character carries the display tag virtually", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })
		const tags = await svc.listForResource(resId)
		expect(tags.map((t) => t.id)).toEqual([display.id])
		expect(tags[0]?.virtual).toBe(true)
	})

	test("the character's own page shows its linked display tag virtually", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		const tags = await svc.listForCharacter(charId)
		expect(tags.map((t) => t.id)).toEqual([display.id])
		expect(tags[0]?.virtual).toBe(true)
	})

	test("a character child rule makes linked resources carry the parent", async () => {
		const parent = await svc.create({ name: "parent", catId: commonId })
		await svc.parentRuleCreate({
			childKind: "character",
			childId: charId,
			parentId: parent.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })
		expect((await svc.listForResource(resId)).map((t) => t.id)).toEqual([
			parent.id,
		])
		// Unrelated resources stay untouched.
		expect(await svc.listForResource(resId2)).toEqual([])
	})

	test("a character child parent rule applies to the character's own page", async () => {
		const parent = await svc.create({ name: "parent", catId: commonId })
		await svc.parentRuleCreate({
			childKind: "character",
			childId: charId,
			parentId: parent.id,
		})
		expect((await svc.listForCharacter(charId)).map((t) => t.id)).toEqual([
			parent.id,
		])
	})

	test("character rules respect kind isolation on parent chains", async () => {
		const resTag = await svc.create({ name: "res", catId: resCatId })
		await expect(
			svc.parentRuleCreate({
				childKind: "character",
				childId: charId,
				parentId: resTag.id,
			}),
		).rejects.toMatchObject({ kind: "tag.parent_rule.kind_isolation" })
	})

	test("searching the display tag matches resources linked to the character", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })
		const resSvc = ctx.resSvc
		const { rows } = await resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
			tagIds: [display.id],
			tagMode: "or",
		})
		expect(rows.map((r) => r.id)).toEqual([resId])
	})

	test("searching the display tag matches the character itself", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		const charSvc = ctx.charSvc
		const { rows } = await charSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
			tagIds: [display.id],
			tagMode: "or",
		})
		expect(rows.map((r) => r.id)).toEqual([charId])
	})

	test("searching a parent matches resources linked to a character child", async () => {
		const parent = await svc.create({ name: "parent", catId: commonId })
		await svc.parentRuleCreate({
			childKind: "character",
			childId: charId,
			parentId: parent.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })
		const { rows } = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
			tagIds: [parent.id],
			tagMode: "or",
		})
		expect(rows.map((r) => r.id)).toEqual([resId])
	})

	test("pinned virtual tags reach cards with the virtual flag", async () => {
		const child = await svc.create({
			name: "child",
			catId: commonId,
			pinned: false,
		})
		const parent = await svc.create({
			name: "parent",
			catId: commonId,
			pinned: true,
		})
		await svc.parentRuleCreate({ childId: child.id, parentId: parent.id })
		await svc.attachToResource(resId, child.id)

		const { rows } = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
		})
		const card = rows.find((r) => r.id === resId)
		expect(card?.pinnedTags.map((t) => t.id)).toEqual([parent.id])
		expect(card?.pinnedTags[0]?.virtual).toBe(true)
	})

	test("a pinned character-link display tag shows as virtual on the resource card", async () => {
		const display = await svc.create({
			name: "display",
			catId: commonId,
			pinned: true,
		})
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })

		const { rows } = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
		})
		const card = rows.find((r) => r.id === resId)
		expect(card?.pinnedTags.map((t) => t.id)).toEqual([display.id])
		expect(card?.pinnedTags[0]?.virtual).toBe(true)
	})

	test("a pinned character-link display tag shows on the character's own card", async () => {
		const display = await svc.create({
			name: "display",
			catId: commonId,
			pinned: true,
		})
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		const { rows } = await ctx.charSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
		})
		const card = rows.find((r) => r.id === charId)
		expect(card?.pinnedTags.map((t) => t.id)).toEqual([display.id])
		expect(card?.pinnedTags[0]?.virtual).toBe(true)
	})

	test("category-pinned virtual tags show like real ones", async () => {
		const child = await svc.create({ name: "child", catId: commonId })
		const parent = await svc.create({ name: "parent", catId: commonId })
		await svc.parentRuleCreate({ childId: child.id, parentId: parent.id })
		ctx.dbh.db
			.update(categories)
			.set({ pinned: true })
			.where(eq(categories.id, parent.catId))
			.run()
		await svc.attachToResource(resId, child.id)

		const { rows } = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
		})
		const card = rows.find((r) => r.id === resId)
		// The category is pinned: the attached child shows as a real pinned
		// tag and the carried parent joins it as virtual.
		expect(card?.pinnedTags.map((t) => t.id)).toEqual([child.id, parent.id])
		expect(card?.pinnedTags.find((t) => t.id === parent.id)?.virtual).toBe(true)
	})

	test("merging a display tag repoints character links to the survivor", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		const survivor = await svc.create({ name: "survivor", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		await svc.merge(display.id, survivor.id)
		const groups = await svc.siblingGroups()
		expect(groups).toHaveLength(1)
		expect(groups[0]).toMatchObject({
			displayTagId: survivor.id,
			memberCharacters: [{ id: charId, name: "c1" }],
		})
	})

	test("hard-deleting a character cascades its rules", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		await svc.parentRuleCreate({
			childKind: "character",
			childId: charId,
			parentId: display.id,
		})
		await ctx.charSvc.softDelete(charId)
		await ctx.charSvc.hardDelete(charId)
		expect(await svc.siblingGroups()).toEqual([])
		expect(await svc.parentRules()).toEqual([])
	})

	test("trashed characters cannot enter new rules", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		await ctx.charSvc.softDelete(charId)
		await expect(
			svc.siblingRuleCreate({
				badKind: "character",
				badId: charId,
				goodId: display.id,
			}),
		).rejects.toMatchObject({ kind: "tag.rule.character_missing" })
		await expect(
			svc.parentRuleCreate({
				childKind: "character",
				childId: charId,
				parentId: display.id,
			}),
		).rejects.toMatchObject({ kind: "tag.rule.character_missing" })
	})

	// ── Sibling-set operations with character members ─────────────────────

	test("promoting a member to display re-links character members to it", async () => {
		const member = await svc.create({ name: "member", catId: commonId })
		const display = await svc.create({ name: "display", catId: commonId })
		await svc.siblingRuleCreate({ badId: member.id, goodId: display.id })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})

		await svc.siblingSetDisplay(member.id)
		const groups = await svc.siblingGroups()
		expect(groups).toHaveLength(1)
		expect(groups[0]).toMatchObject({
			displayTagId: member.id,
			memberTagIds: expect.arrayContaining([member.id, display.id]),
			memberCharacters: [{ id: charId, name: "c1" }],
		})
		// The star rewrite repointed the character link too.
		await ctx.resSvc.update({ id: resId, charIds: [charId] })
		expect((await svc.listForResource(resId)).map((t) => t.id)).toEqual([
			member.id,
		])
	})

	test("deleting the display tag re-links character members to the new display", async () => {
		const member = await svc.create({ name: "member", catId: commonId })
		const display = await svc.create({ name: "display", catId: commonId })
		await svc.siblingRuleCreate({ badId: member.id, goodId: display.id })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})

		await svc.forceDelete(display.id, "display")
		const groups = await svc.siblingGroups()
		expect(groups).toHaveLength(1)
		expect(groups[0]).toMatchObject({
			displayTagId: member.id,
			memberCharacters: [{ id: charId, name: "c1" }],
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })
		expect((await svc.listForResource(resId)).map((t) => t.id)).toEqual([
			member.id,
		])
	})

	test("a character link is replaced, not duplicated, on re-link", async () => {
		const first = await svc.create({ name: "first", catId: commonId })
		const second = await svc.create({ name: "second", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: first.id,
		})
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: second.id,
		})
		const groups = await svc.siblingGroups()
		expect(groups).toHaveLength(1)
		expect(groups[0]).toMatchObject({
			displayTagId: second.id,
			memberCharacters: [{ id: charId, name: "c1" }],
		})
	})

	// ── Group usage counts with character members ─────────────────────────

	test("group counts include resources via character links and the members themselves", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		const tagged = await svc.create({ name: "tagged", catId: commonId })
		await svc.siblingRuleCreate({ badId: tagged.id, goodId: display.id })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		// resId carries the group via the character link; resId2 via the tag.
		await ctx.resSvc.update({ id: resId, charIds: [charId] })
		await svc.attachToResource(resId2, tagged.id)

		const groups = await svc.siblingGroups()
		expect(groups[0]).toMatchObject({ resCount: 2, charCount: 1 })
	})

	// ── Filter modes with character members ────────────────────────────────

	test("filter and-mode requires every selected group, character members included", async () => {
		const first = await svc.create({ name: "first", catId: commonId })
		const second = await svc.create({ name: "second", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: first.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })
		await svc.attachToResource(resId, second.id)
		await svc.attachToResource(resId2, second.id)

		// resId carries both groups; resId2 only the tag group.
		const both = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
			tagIds: [first.id, second.id],
			tagMode: "and",
		})
		expect(both.rows.map((r) => r.id)).toEqual([resId])
	})

	test("filter not-mode excludes resources carrying character members", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })

		const excluded = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
			tagIds: [display.id],
			tagMode: "not",
		})
		expect(excluded.rows.map((r) => r.id)).not.toContain(resId)

		const nor = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
			tagIds: [display.id],
			tagMode: "nor",
		})
		expect(nor.rows.map((r) => r.id)).not.toContain(resId)
	})

	test("searching a multi-level parent matches character descendants", async () => {
		const child = await svc.create({ name: "child", catId: commonId })
		const mid = await svc.create({ name: "mid", catId: commonId })
		const top = await svc.create({ name: "top", catId: commonId })
		await svc.parentRuleCreate({
			childKind: "character",
			childId: charId,
			parentId: child.id,
		})
		await svc.parentRuleCreate({ childId: child.id, parentId: mid.id })
		await svc.parentRuleCreate({ childId: mid.id, parentId: top.id })
		await ctx.resSvc.update({ id: resId, charIds: [charId] })

		const { rows } = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
			tagIds: [top.id],
			tagMode: "or",
		})
		expect(rows.map((r) => r.id)).toEqual([resId])

		// The character itself matches the top-level search too.
		const chars = await ctx.charSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
			tagIds: [top.id],
			tagMode: "or",
		})
		expect(chars.rows.map((r) => r.id)).toEqual([charId])
	})

	// ── Card pipelines ─────────────────────────────────────────────────────

	test("resource detail card carries pinned virtual tags", async () => {
		const child = await svc.create({ name: "child", catId: commonId })
		const parent = await svc.create({
			name: "parent",
			catId: commonId,
			pinned: true,
		})
		await svc.parentRuleCreate({ childId: child.id, parentId: parent.id })
		await svc.attachToResource(resId, child.id)

		const card = await ctx.resSvc.detailCard(resId)
		expect(card?.pinnedTags.map((t) => t.id)).toEqual([parent.id])
		expect(card?.pinnedTags[0]?.virtual).toBe(true)
	})

	test("character detail card carries pinned virtual tags from its own link", async () => {
		const display = await svc.create({
			name: "display",
			catId: commonId,
			pinned: true,
		})
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		const card = await ctx.charSvc.detailCard(charId)
		expect(card?.pinnedTags.map((t) => t.id)).toEqual([display.id])
		expect(card?.pinnedTags[0]?.virtual).toBe(true)
	})

	// ── Combined scenarios ─────────────────────────────────────────────────

	test("a real pinned member and a character link to the same display dedupe", async () => {
		const display = await svc.create({
			name: "display",
			catId: commonId,
			pinned: true,
		})
		const member = await svc.create({ name: "member", catId: commonId })
		await svc.siblingRuleCreate({ badId: member.id, goodId: display.id })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		await svc.attachToResource(resId, member.id)
		await ctx.resSvc.update({ id: resId, charIds: [charId] })

		const { rows } = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
		})
		const card = rows.find((r) => r.id === resId)
		// One display row. The member itself is unpinned, so the row only
		// reaches the card through the character link — virtual.
		expect(card?.pinnedTags.map((t) => t.id)).toEqual([display.id])
		expect(card?.pinnedTags[0]?.virtual).toBe(true)
	})

	test("a pinned member's own display row suppresses the virtual duplicate", async () => {
		const display = await svc.create({
			name: "display",
			catId: commonId,
			pinned: true,
		})
		const member = await svc.create({
			name: "member",
			catId: commonId,
			pinned: true,
		})
		await svc.siblingRuleCreate({ badId: member.id, goodId: display.id })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		await svc.attachToResource(resId, member.id)
		await ctx.resSvc.update({ id: resId, charIds: [charId] })

		const { rows } = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
		})
		const card = rows.find((r) => r.id === resId)
		// The pinned member collapses to the display as a real row; the
		// character link adds nothing.
		expect(card?.pinnedTags.map((t) => t.id)).toEqual([display.id])
		expect(card?.pinnedTags[0]?.virtual).toBeUndefined()
	})

	test("a character's link display and its parent rule combine on the resource", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		const parent = await svc.create({ name: "parent", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		await svc.parentRuleCreate({
			childKind: "character",
			childId: charId,
			parentId: parent.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })

		const tags = await svc.listForResource(resId)
		expect(tags.map((t) => t.id)).toEqual([display.id, parent.id])
		expect(tags.every((t) => t.virtual)).toBe(true)
	})

	// ── Merge interplay ────────────────────────────────────────────────────

	test("merging a tag repoints character-child parent rules and previews count them", async () => {
		const source = await svc.create({ name: "src", catId: commonId })
		const target = await svc.create({ name: "tgt", catId: commonId })
		await svc.parentRuleCreate({
			childKind: "character",
			childId: charId,
			parentId: source.id,
		})
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: source.id,
		})

		const preview = await svc.mergePreview(source.id, target.id)
		expect(preview.parentRuleCount).toBe(1)
		expect(preview.siblingRuleCount).toBe(1)

		await svc.merge(source.id, target.id)
		const rules = await svc.parentRules()
		expect(rules).toEqual([
			{ childKind: "character", childId: charId, parentId: target.id },
		])
		const groups = await svc.siblingGroups()
		expect(groups[0]).toMatchObject({
			displayTagId: target.id,
			memberCharacters: [{ id: charId, name: "c1" }],
		})
	})

	// ── Fast paths ─────────────────────────────────────────────────────────

	test("pinned pipeline returns the real rows unchanged without rules or links", async () => {
		const pinned = await svc.create({
			name: "pinned",
			catId: commonId,
			pinned: true,
		})
		await svc.attachToResource(resId, pinned.id)
		const { rows } = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
		})
		const card = rows.find((r) => r.id === resId)
		expect(card?.pinnedTags).toEqual([
			{ id: pinned.id, name: "pinned", color: "" },
		])
	})
})

describe("character rules — adversarial edge cases", () => {
	let ctx: TagTestContext
	let svc: TagService
	let commonId: string
	let charCatId: string
	let resId: string
	let resId2: string
	let charId: string

	beforeEach(async () => {
		ctx = await createTagTestContext()
		svc = ctx.svc
		commonId = ctx.commonId
		charCatId = ctx.charCatId
		resId = ctx.resId
		resId2 = ctx.resId2
		charId = ctx.charId
	})

	afterEach(() => {
		cleanupTagTestContext(ctx)
	})

	async function resListCards(
		tagIds: readonly string[],
		tagMode: "and" | "or" | "not" | "nor",
	) {
		const { rows } = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
			tagIds,
			tagMode,
		})
		return rows.map((r) => r.id)
	}

	async function charListCards(
		tagIds: readonly string[],
		tagMode: "and" | "or" | "not" | "nor",
	) {
		const { rows } = await ctx.charSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
			tagIds,
			tagMode,
		})
		return rows.map((r) => r.id)
	}

	// ── Filter modes: mixed groups, self-membership, overlapping groups ──

	test("or/and across two groups each carried by a character member", async () => {
		const c2 = await ctx.charSvc.create({ name: "c2" })
		const dA = await svc.create({ name: "dA", catId: commonId })
		const dB = await svc.create({ name: "dB", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: dA.id,
		})
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: c2.id,
			goodId: dB.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId, c2.id] })
		await ctx.resSvc.update({ id: resId2, charIds: [charId] })

		// or: either group's character member matches.
		expect(new Set(await resListCards([dA.id, dB.id], "or"))).toEqual(
			new Set([resId, resId2]),
		)
		// and: the resource must carry both groups' members.
		expect(await resListCards([dA.id, dB.id], "and")).toEqual([resId])
	})

	test("and-mode dedupes two selections from the same group", async () => {
		const dA = await svc.create({ name: "dA", catId: commonId })
		const mA = await svc.create({ name: "mA", catId: commonId })
		await svc.siblingRuleCreate({ badId: mA.id, goodId: dA.id })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: dA.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })

		// Selecting the display AND its member still means "carry the
		// group once" — the single character join satisfies both clauses.
		expect(await resListCards([dA.id, mA.id], "and")).toEqual([resId])
	})

	test("not-mode with a selected member excludes character-carried resources", async () => {
		const dA = await svc.create({ name: "dA", catId: commonId })
		const mA = await svc.create({ name: "mA", catId: commonId })
		await svc.siblingRuleCreate({ badId: mA.id, goodId: dA.id })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: dA.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })

		expect(await resListCards([mA.id], "not")).not.toContain(resId)
		expect(await resListCards([mA.id], "nor")).not.toContain(resId)
	})

	test("character list: self-membership and attached tags combine across modes", async () => {
		const dA = await svc.create({ name: "dA", catId: commonId })
		const dB = await svc.create({ name: "dB", catId: commonId })
		const mB = await svc.create({ name: "mB", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: dA.id,
		})
		await svc.siblingRuleCreate({ badId: mB.id, goodId: dB.id })
		await svc.attachToCharacter(charId, mB.id)

		// Selecting a group's member matches the character itself.
		expect(await charListCards([mB.id], "or")).toEqual([charId])
		// and-mode: self-membership of A plus an attached member of B.
		expect(await charListCards([dA.id, dB.id], "and")).toEqual([charId])
		// not-mode excludes the self-member.
		expect(await charListCards([dA.id], "not")).not.toContain(charId)
		// An unknown selection matches nothing in positive modes and
		// everything in negative ones (nothing carries it, so nothing is
		// excluded).
		expect(await charListCards(["tag-missing"], "or")).toEqual([])
		expect(await charListCards(["tag-missing"], "not")).toContain(charId)
	})

	test("searching a parent whose child is a linked character matches its group", async () => {
		const dA = await svc.create({ name: "dA", catId: commonId })
		const parent = await svc.create({ name: "parent", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: dA.id,
		})
		await svc.parentRuleCreate({
			childKind: "character",
			childId: charId,
			parentId: parent.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })

		expect(await resListCards([parent.id], "or")).toEqual([resId])
		expect(await charListCards([parent.id], "or")).toEqual([charId])
	})

	// ── Pinned virtual pipeline ─────────────────────────────────────────

	test("a character-child parent rule's pinned parent is virtual on both cards", async () => {
		const parent = await svc.create({
			name: "parent",
			catId: commonId,
			pinned: true,
		})
		await svc.parentRuleCreate({
			childKind: "character",
			childId: charId,
			parentId: parent.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })

		const { rows } = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
		})
		const card = rows.find((r) => r.id === resId)
		expect(card?.pinnedTags.map((t) => t.id)).toEqual([parent.id])
		expect(card?.pinnedTags[0]?.virtual).toBe(true)

		const detail = await ctx.resSvc.detailCard(resId)
		expect(detail?.pinnedTags.map((t) => t.id)).toEqual([parent.id])
		expect(detail?.pinnedTags[0]?.virtual).toBe(true)

		// The character's own card carries the rule too — no real pinned
		// rows at all.
		const { rows: cardRows } = await ctx.charSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
		})
		expect(cardRows.map((r) => r.id)).toContain(charId)
		const charCard = cardRows.find((r) => r.id === charId)
		expect(charCard?.pinnedTags.map((t) => t.id)).toEqual([parent.id])
		expect(charCard?.pinnedTags[0]?.virtual).toBe(true)
	})

	test("virtual and real pinned tags interleave by category position", async () => {
		// The real child lives in the common namespace (moved late); the
		// virtual parent lives in a fresh low-position namespace.
		ctx.dbh.db
			.update(categories)
			.set({ position: 10 })
			.where(eq(categories.id, commonId))
			.run()
		const now = Date.now()
		ctx.dbh.db
			.insert(categories)
			.values({
				id: "cat-low",
				name: "Low",
				intro: "",
				color: "",
				kind: "common",
				position: 0,
				pinned: false,
				createdAt: now,
				updatedAt: now,
			})
			.run()
		const child = await svc.create({
			name: "child",
			catId: commonId,
			pinned: true,
		})
		const parent = await svc.create({
			name: "parent",
			catId: "cat-low",
			pinned: true,
		})
		await svc.parentRuleCreate({ childId: child.id, parentId: parent.id })
		await svc.attachToResource(resId, child.id)

		const { rows } = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
		})
		const card = rows.find((r) => r.id === resId)
		expect(card?.pinnedTags.map((t) => t.id)).toEqual([parent.id, child.id])
		expect(card?.pinnedTags[0]?.virtual).toBe(true)
		expect(card?.pinnedTags[1]?.virtual).toBeUndefined()
	})

	test("a category-pinned parent shows virtual even when the tag is unpinned", async () => {
		const child = await svc.create({
			name: "child",
			catId: commonId,
			pinned: true,
		})
		const parent = await svc.create({ name: "parent", catId: charCatId })
		await svc.parentRuleCreate({ childId: child.id, parentId: parent.id })
		ctx.dbh.db
			.update(categories)
			.set({ pinned: true })
			.where(eq(categories.id, charCatId))
			.run()
		await svc.attachToResource(resId, child.id)

		const { rows } = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
		})
		const card = rows.find((r) => r.id === resId)
		expect(card?.pinnedTags.map((t) => t.id)).toEqual([child.id, parent.id])
		expect(card?.pinnedTags.find((t) => t.id === parent.id)?.virtual).toBe(true)
	})

	test("detaching the member or unlinking the character removes the virtual display", async () => {
		const display = await svc.create({
			name: "display",
			catId: commonId,
			pinned: true,
		})
		const member = await svc.create({
			name: "member",
			catId: commonId,
			pinned: true,
		})
		await svc.siblingRuleCreate({ badId: member.id, goodId: display.id })
		await svc.attachToResource(resId, member.id)

		const cardOf = async () => {
			const { rows } = await ctx.resSvc.listCards({
				query: undefined,
				page: 1,
				size: 50,
			})
			return rows.find((r) => r.id === resId)?.pinnedTags ?? []
		}
		expect((await cardOf()).map((t) => t.id)).toEqual([display.id])

		await svc.detachFromResource(resId, member.id)
		expect(await cardOf()).toEqual([])
		expect(await svc.listForResource(resId)).toEqual([])

		// The same holds for a character link.
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })
		expect((await cardOf()).map((t) => t.id)).toEqual([display.id])
		await ctx.resSvc.update({ id: resId, charIds: [] })
		expect(await cardOf()).toEqual([])
	})

	test("a parent that is a sibling member resolves to its display", async () => {
		const display = await svc.create({
			name: "display",
			catId: commonId,
			pinned: true,
		})
		const member = await svc.create({ name: "member", catId: commonId })
		await svc.siblingRuleCreate({ badId: member.id, goodId: display.id })
		await svc.parentRuleCreate({
			childKind: "character",
			childId: charId,
			parentId: member.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })

		// The rule's parent renders as its group's display, not the member.
		const tags = await svc.listForResource(resId)
		expect(tags.map((t) => t.id)).toEqual([display.id])
		expect(tags[0]?.virtual).toBe(true)

		const { rows } = await ctx.resSvc.listCards({
			query: undefined,
			page: 1,
			size: 50,
		})
		const card = rows.find((r) => r.id === resId)
		expect(card?.pinnedTags.map((t) => t.id)).toEqual([display.id])
		expect(card?.pinnedTags[0]?.virtual).toBe(true)
	})

	// ── listForResource / listForCharacter transitive closure ──────────

	test("char link, char-child rule and tag rules chain transitively", async () => {
		const dA = await svc.create({ name: "dA", catId: commonId })
		const p1 = await svc.create({ name: "p1", catId: commonId })
		const p2 = await svc.create({ name: "p2", catId: commonId })
		const p3 = await svc.create({ name: "p3", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: dA.id,
		})
		await svc.parentRuleCreate({
			childKind: "character",
			childId: charId,
			parentId: p1.id,
		})
		await svc.parentRuleCreate({ childId: dA.id, parentId: p2.id })
		await svc.parentRuleCreate({ childId: p2.id, parentId: p3.id })
		await ctx.resSvc.update({ id: resId, charIds: [charId] })

		const tags = await svc.listForResource(resId)
		expect(tags.map((t) => t.id)).toEqual([dA.id, p1.id, p2.id, p3.id])
		expect(tags.every((t) => t.virtual)).toBe(true)

		// The character's own page carries the same chain.
		const own = await svc.listForCharacter(charId)
		expect(own.map((t) => t.id)).toEqual([dA.id, p1.id, p2.id, p3.id])

		// Removing a middle rule makes the dangling descendants vanish.
		await svc.parentRuleRemove({ childId: p2.id, parentId: p3.id })
		expect((await svc.listForResource(resId)).map((t) => t.id)).toEqual([
			dA.id,
			p1.id,
			p2.id,
		])
	})

	test("an attached member and a char link to the same display collapse to one real row", async () => {
		const display = await svc.create({
			name: "display",
			catId: commonId,
			pinned: true,
		})
		const member = await svc.create({ name: "member", catId: commonId })
		await svc.siblingRuleCreate({ badId: member.id, goodId: display.id })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		await svc.attachToResource(resId, member.id)
		await ctx.resSvc.update({ id: resId, charIds: [charId] })

		const tags = await svc.listForResource(resId)
		expect(tags.map((t) => t.id)).toEqual([display.id])
		expect(tags[0]?.virtual).toBeUndefined()
	})

	test("removing the sibling link makes the display vanish from the lists", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		await ctx.resSvc.update({ id: resId, charIds: [charId] })
		expect((await svc.listForResource(resId)).map((t) => t.id)).toEqual([
			display.id,
		])
		expect((await svc.listForCharacter(charId)).map((t) => t.id)).toEqual([
			display.id,
		])

		await svc.siblingRuleRemove(charId, "character")
		expect(await svc.listForResource(resId)).toEqual([])
		expect(await svc.listForCharacter(charId)).toEqual([])
	})

	// ── Rule CRUD edge cases ────────────────────────────────────────────

	test("siblingSetDisplay on the display itself is a no-op", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		const member = await svc.create({ name: "member", catId: commonId })
		await svc.siblingRuleCreate({ badId: member.id, goodId: display.id })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})

		await svc.siblingSetDisplay(display.id)
		const groups = await svc.siblingGroups()
		expect(groups).toHaveLength(1)
		expect(groups[0]).toMatchObject({
			displayTagId: display.id,
			memberTagIds: expect.arrayContaining([member.id, display.id]),
			memberCharacters: [{ id: charId, name: "c1" }],
		})
	})

	test("siblingSetDisplay accepts only tag ids", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})
		await expect(svc.siblingSetDisplay(charId)).rejects.toMatchObject({
			code: "NOT_FOUND",
		})
		// The group survives the rejected promotion.
		expect(await svc.siblingGroups()).toHaveLength(1)
	})

	test("removing missing pairs and rules is idempotent", async () => {
		await expect(svc.siblingRuleRemove("tag-missing")).resolves.toBeUndefined()
		await expect(
			svc.siblingRuleRemove("char-missing", "character"),
		).resolves.toBeUndefined()
		await expect(
			svc.parentRuleRemove({
				childKind: "character",
				childId: "char-missing",
				parentId: "tag-missing",
			}),
		).resolves.toBeUndefined()
		await expect(
			svc.parentRuleRemove({ childId: "tag-missing", parentId: "tag-missing" }),
		).resolves.toBeUndefined()
	})

	test("a tag pair and a character pair sharing one raw id stay independent", async () => {
		// Id spaces are per-kind; a colliding raw id (impossible via the
		// service, but legal at the DB level) must not confuse the graphs.
		const now = Date.now()
		ctx.dbh.db
			.insert(tagsTable)
			.values({
				id: charId,
				name: "shadow",
				intro: "",
				color: "",
				position: 0,
				pinned: false,
				catId: commonId,
				createdAt: now,
				updatedAt: now,
			})
			.run()
		const target = await svc.create({ name: "target", catId: commonId })
		ctx.dbh.db
			.insert(siblingPairs)
			.values({
				badKind: "tag",
				badId: charId,
				badCharacterId: null,
				goodId: target.id,
				createdAt: now,
			})
			.run()
		ctx.dbh.db
			.insert(siblingPairs)
			.values({
				badKind: "character",
				badId: null,
				badCharacterId: charId,
				goodId: target.id,
				createdAt: now,
			})
			.run()

		const groups = await svc.siblingGroups()
		expect(groups).toHaveLength(1)
		expect(groups[0]).toMatchObject({
			displayTagId: target.id,
			memberTagIds: [target.id],
			memberCharacters: [{ id: charId, name: "c1" }],
		})

		// Removing the tag-side pair leaves the character link intact.
		await svc.siblingRuleRemove(charId, "tag")
		const remaining = await svc.siblingGroups()
		expect(remaining).toHaveLength(1)
		expect(remaining[0]).toMatchObject({
			displayTagId: target.id,
			memberCharacters: [{ id: charId, name: "c1" }],
		})
	})

	test("the sibling-pair endpoint-exclusive CHECK rejects ambiguous rows", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		expect(() =>
			ctx.dbh.db
				.insert(siblingPairs)
				.values({
					badKind: "tag",
					badId: display.id,
					badCharacterId: charId,
					goodId: display.id,
					createdAt: Date.now(),
				})
				.run(),
		).toThrow()
	})

	// ── Merge interplay ─────────────────────────────────────────────────

	test("merging a member of a group with character members moves the char links", async () => {
		const display = await svc.create({ name: "display", catId: commonId })
		const member = await svc.create({ name: "member", catId: commonId })
		const target = await svc.create({ name: "target", catId: commonId })
		await svc.siblingRuleCreate({ badId: member.id, goodId: display.id })
		await svc.siblingRuleCreate({
			badKind: "character",
			badId: charId,
			goodId: display.id,
		})

		const preview = await svc.mergePreview(member.id, target.id)
		expect(preview.siblingRuleCount).toBe(1)

		await svc.merge(member.id, target.id)
		const groups = await svc.siblingGroups()
		expect(groups).toHaveLength(1)
		expect(groups[0]).toMatchObject({
			displayTagId: target.id,
			memberTagIds: expect.arrayContaining([target.id, display.id]),
			memberCharacters: [{ id: charId, name: "c1" }],
		})

		// The character's link now resolves to the merged group's display.
		await ctx.resSvc.update({ id: resId, charIds: [charId] })
		expect((await svc.listForResource(resId)).map((t) => t.id)).toEqual([
			target.id,
		])
	})

	// ── Card pipelines ──────────────────────────────────────────────────

	test("memories() cards carry virtual pinned tags", async () => {
		const child = await svc.create({ name: "child", catId: commonId })
		const parent = await svc.create({
			name: "parent",
			catId: commonId,
			pinned: true,
		})
		await svc.parentRuleCreate({ childId: child.id, parentId: parent.id })
		await svc.attachToResource(resId, child.id)
		const year = new Date().getUTCFullYear()
		ctx.dbh.db
			.update(resources)
			.set({ createdAt: Date.UTC(year - 1, 5, 12) })
			.where(eq(resources.id, resId))
			.run()

		const rows = await ctx.resSvc.memories({ month: 6, day: 12, offsetMin: 0 })
		expect(rows.map((r) => r.id)).toEqual([resId])
		expect(rows[0]?.pinnedTags.map((t) => t.id)).toEqual([parent.id])
		expect(rows[0]?.pinnedTags[0]?.virtual).toBe(true)
	})
})
