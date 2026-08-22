import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DomainError } from "@hoardodile/shared"
import { eq } from "drizzle-orm"
import { tags } from "src/domain/tag/schema.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import {
	createStoragePaths,
	type StoragePaths,
} from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createRelationshipService } from "./relationship_service.ts"
import { characters } from "./schema.ts"
import { type CharService, createCharacterService } from "./service.ts"

describe("character service", () => {
	let root: string
	let dbh: DbHandles
	let paths: StoragePaths
	let svc: CharService

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-character-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
		paths = createStoragePaths({ root })
		svc = createCharacterService({
			db: dbh.db,
			paths,
			readOnly: { current: false },
		})
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("create persists the row and creates the character folder", async () => {
		const c = await svc.create({ name: "Alice" })
		expect(c.id).toBeTruthy()
		expect(c.name).toBe("Alice")
		expect(c.intro).toBe("")
		expect(c.tagIds).toEqual([])
		expect(c.traitValues).toEqual({})
		expect(c.imageMeta).toEqual({
			avatar: { empty: true },
			fullbody: { empty: true },
		})
		expect(existsSync(paths.active.character(c.id))).toBe(true)
	})

	test("create with all optional fields", async () => {
		dbh.db
			.insert(tags)
			.values({ id: "t1", name: "t1", createdAt: 0, updatedAt: 0 })
			.run()
		const c = await svc.create({
			name: "Bob",
			intro: "a character",
			tagIds: ["t1"],
			traitValues: { gender: "male" },
		})
		expect(c.intro).toBe("a character")
		expect(c.tagIds).toEqual(["t1"])
		expect(c.traitValues).toEqual({ gender: "male" })
	})

	test("full lifecycle: create -> list -> detail -> edit -> soft delete -> trash -> restore -> soft delete -> hard delete", async () => {
		const a = await svc.create({ name: "alpha" })
		const b = await svc.create({ name: "beta" })
		expect((await svc.list({})).total).toBe(2)
		expect((await svc.detail(a.id)).name).toBe("alpha")

		const edited = await svc.update({
			id: a.id,
			name: "alpha-updated",
			intro: "notes",
		})
		expect(edited.name).toBe("alpha-updated")
		expect(edited.intro).toBe("notes")

		const trashed = await svc.softDelete(a.id)
		expect(trashed.deletedAt).toBeTypeOf("number")
		expect((await svc.list({})).rows.map((r) => r.id)).toEqual([b.id])
		expect((await svc.trashList({})).rows.map((r) => r.id)).toEqual([a.id])

		const restored = await svc.restore(a.id)
		expect(restored.deletedAt).toBeUndefined()
		expect((await svc.list({})).total).toBe(2)

		await svc.softDelete(a.id)
		const result = await svc.hardDelete(a.id)
		expect(result.trashedPath.startsWith(paths.local.trash())).toBe(true)
		expect(result.trashedPath).toContain(a.id)
		expect(existsSync(paths.active.character(a.id))).toBe(false)
		expect(existsSync(result.trashedPath)).toBe(true)
		expect(existsSync(paths.active.deletedMarker("characters", a.id))).toBe(
			false,
		)
		await expect(svc.detail(a.id)).rejects.toThrow(DomainError)
	})

	test("softDelete twice throws conflict", async () => {
		const c = await svc.create({ name: "Alice" })
		await svc.softDelete(c.id)
		await expect(svc.softDelete(c.id)).rejects.toThrow(DomainError)
	})

	test("softDeleteMany moves live rows and collects already-trashed ids", async () => {
		const a = await svc.create({ name: "a" })
		const b = await svc.create({ name: "b" })
		await svc.softDelete(b.id)
		const r = await svc.softDeleteMany([a.id, b.id, a.id])
		expect(r.okIds).toEqual([a.id])
		expect(r.failures).toHaveLength(1)
		expect(r.failures[0]?.id).toBe(b.id)
		expect((await svc.list({})).total).toBe(0)
		const trashIds = (await svc.trashList({})).rows.map((x) => x.id).sort()
		expect(trashIds).toEqual([a.id, b.id].sort())
	})

	test("softDeleteMany reports missing ids as failures", async () => {
		const a = await svc.create({ name: "a" })
		const r = await svc.softDeleteMany([a.id, "missing-id"])
		expect(r.okIds).toEqual([a.id])
		expect(r.failures).toHaveLength(1)
		expect(r.failures[0]?.id).toBe("missing-id")
	})

	test("restore non-trashed throws conflict", async () => {
		const c = await svc.create({ name: "Alice" })
		await expect(svc.restore(c.id)).rejects.toThrow(DomainError)
	})

	test("hardDelete without prior soft delete throws conflict", async () => {
		const c = await svc.create({ name: "Alice" })
		await expect(svc.hardDelete(c.id)).rejects.toThrow(DomainError)
	})

	test("hardDelete writes .deleted only when image versions point at past archives", async () => {
		paths = createStoragePaths({ root, latestVersion: 2 })
		svc = createCharacterService({
			db: dbh.db,
			paths,
			readOnly: { current: false },
		})
		const c = await svc.create({ name: "legacy" })
		dbh.db
			.update(characters)
			.set({ avatarVersion: 1, fullbodyVersion: 1 })
			.where(eq(characters.id, c.id))
			.run()
		await svc.softDelete(c.id)
		const result = await svc.hardDelete(c.id)
		expect(result.trashedPath).toContain(".deleted")
		expect(existsSync(paths.latest.deletedMarker("characters", c.id))).toBe(
			true,
		)
	})

	test("LIKE search excludes soft-deleted, includes after restore", async () => {
		const a = await svc.create({ name: "searchable alpha" })
		await svc.create({ name: "beta" })
		expect(
			(await svc.list({ query: "searchable" })).rows.map((r) => r.id),
		).toEqual([a.id])
		await svc.softDelete(a.id)
		expect((await svc.list({ query: "searchable" })).rows).toHaveLength(0)
		await svc.restore(a.id)
		expect((await svc.list({ query: "searchable" })).rows).toHaveLength(1)
	})

	test("list returns paginated results", async () => {
		const ids: string[] = []
		for (let i = 0; i < 5; i++) {
			const c = await svc.create({ name: `char-${i}` })
			ids.push(c.id)
		}
		const page1 = await svc.list({ page: 1, size: 3 })
		expect(page1.total).toBe(5)
		expect(page1.rows).toHaveLength(3)
		const page2 = await svc.list({ page: 2, size: 3 })
		expect(page2.rows).toHaveLength(2)
	})

	test("detail throws NOT_FOUND for missing id", async () => {
		await expect(svc.detail("nonexistent")).rejects.toThrow(DomainError)
	})

	test("traitFilters narrow list results across operators", async () => {
		const { traitDefs } = await import("src/domain/trait/schema.ts")
		dbh.db
			.insert(traitDefs)
			.values([
				{
					id: "h",
					name: "height",
					kind: "height",
					position: 0,
					pinned: false,
					intro: "",
					createdAt: 0,
					updatedAt: 0,
				},
				{
					id: "n",
					name: "nick",
					kind: "text",
					position: 1,
					pinned: false,
					intro: "",
					createdAt: 0,
					updatedAt: 0,
				},
			])
			.run()
		await svc.create({
			name: "tall",
			traitValues: { h: "180cm", n: "Ace" },
		})
		await svc.create({
			name: "short",
			traitValues: { h: "150cm", n: "Bee" },
		})
		await svc.create({ name: "noheight", traitValues: { n: "Cee" } })

		const tallOnly = await svc.list({
			traitFilters: [{ traitId: "h", op: ">=", value: 170 }],
		})
		expect(tallOnly.total).toBe(1)
		expect(tallOnly.rows[0]?.name).toBe("tall")

		const containsBee = await svc.list({
			traitFilters: [{ traitId: "n", op: "contains", value: "bee" }],
		})
		expect(containsBee.total).toBe(1)
		expect(containsBee.rows[0]?.name).toBe("short")

		const empty = await svc.list({
			traitFilters: [{ traitId: "h", op: "empty" }],
		})
		expect(empty.total).toBe(1)
		expect(empty.rows[0]?.name).toBe("noheight")

		const notempty = await svc.list({
			traitFilters: [{ traitId: "h", op: "notempty" }],
		})
		expect(notempty.total).toBe(2)

		const emptyContains = await svc.list({
			traitFilters: [{ traitId: "n", op: "contains", value: "" }],
		})
		expect(emptyContains.total).toBe(3)
	})

	test("traitFilters work for date kind", async () => {
		const { traitDefs } = await import("src/domain/trait/schema.ts")
		const dateRaw = (y: number, sign: "+" | "-" = "+") =>
			JSON.stringify({ p: "AD", s: sign, y, m: 1, d: 1 })
		dbh.db
			.insert(traitDefs)
			.values({
				id: "b",
				name: "date",
				kind: "date",
				position: 0,
				pinned: false,
				intro: "",
				createdAt: 0,
				updatedAt: 0,
			})
			.run()
		await svc.create({
			name: "future",
			traitValues: { b: dateRaw(3000) },
		})
		await svc.create({
			name: "recent",
			traitValues: { b: dateRaw(2000) },
		})
		await svc.create({
			name: "ancient",
			traitValues: { b: dateRaw(100, "-") },
		})

		const after1999 = await svc.list({
			traitFilters: [
				{
					traitId: "b",
					op: "dateAfter",
					value: { sign: "+", year: 2000, month: 1, day: 1 },
				},
			],
		})
		expect(after1999.total).toBe(1)
		expect(after1999.rows[0]?.name).toBe("future")

		await svc.create({
			name: "birthday",
			traitValues: {
				b: JSON.stringify({ p: "AD", s: "+", y: 1990, m: 6, d: 12 }),
			},
		})

		const notempty = await svc.list({
			traitFilters: [{ traitId: "b", op: "notempty" }],
		})
		expect(notempty.total).toBe(4)

		const sameMonthDay = await svc.list({
			traitFilters: [
				{
					traitId: "b",
					op: "dateMonthDayOn",
					value: { month: 6, day: 12 },
				},
			],
		})
		expect(sameMonthDay.total).toBe(1)
		expect(sameMonthDay.rows[0]?.name).toBe("birthday")
	})

	test("traitFilters match partial dates with range semantics", async () => {
		const { traitDefs } = await import("src/domain/trait/schema.ts")
		dbh.db
			.insert(traitDefs)
			.values({
				id: "b",
				name: "date",
				kind: "date",
				position: 0,
				pinned: false,
				intro: "",
				createdAt: 0,
				updatedAt: 0,
			})
			.run()

		await svc.create({
			name: "year-only",
			traitValues: { b: JSON.stringify({ s: "+", y: 2000 }) },
		})
		await svc.create({
			name: "year-month",
			traitValues: { b: JSON.stringify({ s: "+", y: 2000, m: 6 }) },
		})
		await svc.create({
			name: "full-june",
			traitValues: {
				b: JSON.stringify({ s: "+", y: 2000, m: 6, d: 12 }),
			},
		})
		await svc.create({
			name: "full-july",
			traitValues: {
				b: JSON.stringify({ s: "+", y: 2000, m: 7, d: 1 }),
			},
		})

		// dateOn for 2000-06-12 should match the year-only, year-month and exact date.
		const onMidJune = await svc.list({
			traitFilters: [
				{
					traitId: "b",
					op: "dateOn",
					value: { sign: "+", year: 2000, month: 6, day: 12 },
				},
			],
		})
		expect(onMidJune.total).toBe(3)

		// dateBefore 2000-07-01 only matches dates whose entire known range is
		// before July: the year-month and the exact June date, but not the
		// whole-year value which could include July-December.
		const beforeJuly = await svc.list({
			traitFilters: [
				{
					traitId: "b",
					op: "dateBefore",
					value: { sign: "+", year: 2000, month: 7, day: 1 },
				},
			],
		})
		expect(beforeJuly.total).toBe(2)

		// dateAfter 2000-06-30 should only match July.
		const afterJune = await svc.list({
			traitFilters: [
				{
					traitId: "b",
					op: "dateAfter",
					value: { sign: "+", year: 2000, month: 6, day: 30 },
				},
			],
		})
		expect(afterJune.total).toBe(1)
		expect(afterJune.rows[0]?.name).toBe("full-july")

		// month-day filter still matches year-less dates.
		const monthDay = await svc.list({
			traitFilters: [
				{ traitId: "b", op: "dateMonthDayOn", value: { month: 6, day: 12 } },
			],
		})
		expect(monthDay.total).toBe(1)
		expect(monthDay.rows[0]?.name).toBe("full-june")
	})

	test("traitFilters dateMonthDayToday is rejected server-side", async () => {
		const { traitDefs } = await import("src/domain/trait/schema.ts")
		dbh.db
			.insert(traitDefs)
			.values({
				id: "b",
				name: "date",
				kind: "date",
				position: 0,
				pinned: false,
				intro: "",
				createdAt: 0,
				updatedAt: 0,
			})
			.run()

		await expect(
			svc.list({
				traitFilters: [{ traitId: "b", op: "dateMonthDayToday" }],
			}),
		).rejects.toMatchObject({
			code: "VALIDATION",
			kind: "char.trait_filter_date_month_day_today",
		})
	})

	test("detailCard relations include only pinned relationship types with color", async () => {
		const relationships = createRelationshipService({ db: dbh.db })
		const pinnedType = await relationships.createType({
			name: "Friend",
			selfLabel: "friend",
			targetLabel: "friend",
			pinned: true,
			color: "#aabbcc",
		})
		await relationships.createType({
			name: "Rival",
			selfLabel: "rival",
			targetLabel: "rival",
			pinned: false,
		})
		const alice = await svc.create({ name: "Alice" })
		const bob = await svc.create({ name: "Bob" })
		const carol = await svc.create({ name: "Carol" })
		const rivalType = (await relationships.listTypes()).find(
			(type) => type.name === "Rival",
		)
		if (rivalType === undefined) {
			throw new Error("expected Rival relationship type")
		}
		await relationships.createCharactership({
			typeId: pinnedType.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		await relationships.createCharactership({
			typeId: rivalType.id,
			selfId: alice.id,
			targetId: carol.id,
		})

		const card = await svc.detailCard(alice.id)
		expect(card.relations).toHaveLength(1)
		expect(card.relations[0]).toEqual({
			id: bob.id,
			name: "Bob",
			labels: ["friend"],
			color: "#aabbcc",
			updatedAt: expect.any(Number),
			imageMeta: {
				avatar: { empty: true },
				fullbody: { empty: true },
			},
		})
	})

	test("detailCard uses selfLabel when anchor is targetId", async () => {
		const relationships = createRelationshipService({ db: dbh.db })
		const mentorType = await relationships.createType({
			name: "Mentor",
			selfLabel: "mentor",
			targetLabel: "apprentice",
			pinned: true,
		})
		const alice = await svc.create({ name: "Alice" })
		const bob = await svc.create({ name: "Bob" })
		await relationships.createCharactership({
			typeId: mentorType.id,
			selfId: alice.id,
			targetId: bob.id,
		})

		const card = await svc.detailCard(bob.id)
		expect(card.relations).toHaveLength(1)
		expect(card.relations[0]).toEqual({
			id: alice.id,
			name: "Alice",
			labels: ["mentor"],
			color: "",
			updatedAt: expect.any(Number),
			imageMeta: {
				avatar: { empty: true },
				fullbody: { empty: true },
			},
		})
	})

	test("detailCard omits relations when pinned type labels are empty", async () => {
		const relationships = createRelationshipService({ db: dbh.db })
		const emptyLabelType = await relationships.createType({
			name: "Unlabeled",
			selfLabel: "",
			targetLabel: "",
			pinned: true,
		})
		const alice = await svc.create({ name: "Alice" })
		const bob = await svc.create({ name: "Bob" })
		await relationships.createCharactership({
			typeId: emptyLabelType.id,
			selfId: alice.id,
			targetId: bob.id,
		})

		const card = await svc.detailCard(alice.id)
		expect(card.relations).toHaveLength(0)
	})

	test("detailCard merges multiple pinned labels for the same character", async () => {
		const relationships = createRelationshipService({ db: dbh.db })
		const friendType = await relationships.createType({
			name: "Friend",
			selfLabel: "friend",
			targetLabel: "friend",
			pinned: true,
		})
		const coworkerType = await relationships.createType({
			name: "Coworker",
			selfLabel: "coworker",
			targetLabel: "coworker",
			pinned: true,
		})
		const alice = await svc.create({ name: "Alice" })
		const bob = await svc.create({ name: "Bob" })
		await relationships.createCharactership({
			typeId: friendType.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		await relationships.createCharactership({
			typeId: coworkerType.id,
			selfId: alice.id,
			targetId: bob.id,
		})

		const card = await svc.detailCard(alice.id)
		expect(card.relations).toHaveLength(1)
		expect(card.relations[0]?.labels.sort()).toEqual(["coworker", "friend"])
	})

	test("relationshipTypeIds filter requires every selected type (AND)", async () => {
		const relationships = createRelationshipService({ db: dbh.db })
		const friendType = await relationships.createType({
			name: "Friend",
			selfLabel: "friend",
			targetLabel: "friend",
		})
		const rivalType = await relationships.createType({
			name: "Rival",
			selfLabel: "rival",
			targetLabel: "rival",
		})
		const alice = await svc.create({ name: "Alice" })
		const bob = await svc.create({ name: "Bob" })
		const carol = await svc.create({ name: "Carol" })
		await relationships.createCharactership({
			typeId: friendType.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		await relationships.createCharactership({
			typeId: rivalType.id,
			selfId: alice.id,
			targetId: carol.id,
		})

		const friendOnly = await svc.list({ relationshipTypeIds: [friendType.id] })
		expect(friendOnly.total).toBe(2)
		expect(friendOnly.rows.map((row) => row.name).sort()).toEqual([
			"Alice",
			"Bob",
		])

		const both = await svc.list({
			relationshipTypeIds: [friendType.id, rivalType.id],
		})
		expect(both.total).toBe(1)
		expect(both.rows[0]?.name).toBe("Alice")
	})

	test("detailCard includes pinned traits with non-empty values", async () => {
		const { createTraitService } = await import("src/domain/trait/service.ts")
		const traits = createTraitService({ db: dbh.db })
		const pinned = await traits.create({
			name: "Height",
			kind: "height",
			pinned: true,
			color: "#112233",
		})
		const emptyPinned = await traits.create({
			name: "Notes",
			kind: "text",
			pinned: true,
		})
		const unpinned = await traits.create({
			name: "Age",
			kind: "number",
			pinned: false,
		})
		const c = await svc.create({
			name: "Alice",
			traitValues: {
				[pinned.id]: "170",
				[emptyPinned.id]: "   ",
				[unpinned.id]: "20",
			},
		})

		const card = await svc.detailCard(c.id)
		expect(card.pinnedTraits).toEqual([
			{
				id: pinned.id,
				name: "Height",
				color: "#112233",
				kind: "height",
				value: "170",
			},
		])
	})

	test("setImage writes avatar to the current version and bumps avatarVersion", async () => {
		const c = await svc.create({ name: "Alice" })
		const source = join(root, "tmp-avatar.png")
		writeFileSync(source, "fake-image")

		await svc.setImage(c.id, "avatar", ".png", source)
		expect(await svc.getVariantVersion(c.id, "avatar")).toBe(
			paths.latestVersion,
		)

		const imagePath = await svc.resolveImagePath(c.id, "avatar")
		expect(imagePath).toBeTruthy()
		expect(imagePath?.startsWith(paths.latest.character(c.id))).toBe(true)
		expect(existsSync(imagePath ?? "")).toBe(true)
	})

	test("list fills missing imageMeta from disk without bumping updatedAt", async () => {
		const c = await svc.create({ name: "Alice" })
		const before = c.updatedAt
		dbh.db
			.update(characters)
			.set({ imageMeta: null })
			.where(eq(characters.id, c.id))
			.run()
		const listed = await svc.list({ page: 1, size: 10 })
		const row = listed.rows.find((item) => item.id === c.id)
		expect(row?.imageMeta).toEqual({
			avatar: { empty: true },
			fullbody: { empty: true },
		})
		expect(row?.updatedAt).toBe(before)
	})

	test("clearAllImageMeta nulls the column without bumping updatedAt", async () => {
		const c = await svc.create({ name: "Alice" })
		expect(c.imageMeta).toEqual({
			avatar: { empty: true },
			fullbody: { empty: true },
		})
		svc.clearAllImageMeta()
		const stored = dbh.db
			.select()
			.from(characters)
			.where(eq(characters.id, c.id))
			.get()
		expect(stored?.imageMeta).toBeNull()
		expect(stored?.updatedAt).toBe(c.updatedAt)
	})

	test("setImage archives a previous avatar to local/ before writing the new one", async () => {
		const c = await svc.create({ name: "Alice" })
		const first = join(root, "first.png")
		const second = join(root, "second.png")
		writeFileSync(first, "first-image")
		writeFileSync(second, "second-image")

		await svc.setImage(c.id, "avatar", ".png", first)
		const firstContent = readFileSync(
			(await svc.resolveImagePath(c.id, "avatar")) ?? "",
		)

		await svc.setImage(c.id, "avatar", ".png", second)
		const secondContent = readFileSync(
			(await svc.resolveImagePath(c.id, "avatar")) ?? "",
		)

		expect(secondContent).not.toEqual(firstContent)
		expect(existsSync(paths.local.character(c.id))).toBe(true)
		const archived = readdirSync(paths.local.character(c.id)).some((name) =>
			name.startsWith("avatar_"),
		)
		expect(archived).toBe(true)
	})

	test("clearImage removes the current avatar and bumps avatarVersion", async () => {
		const c = await svc.create({ name: "Alice" })
		const source = join(root, "avatar.png")
		writeFileSync(source, "fake-image")

		const afterSet = await svc.setImage(c.id, "avatar", ".png", source)
		expect(afterSet.imageMeta?.avatar).toMatchObject({ kind: "image" })
		expect(afterSet.imageMeta?.fullbody).toEqual({ empty: true })

		const cleared = await svc.clearImage(c.id, "avatar")
		expect(await svc.getVariantVersion(c.id, "avatar")).toBe(
			paths.latestVersion,
		)

		const imagePath = await svc.resolveImagePath(c.id, "avatar")
		expect(imagePath).toBeUndefined()
		expect(cleared.imageMeta?.avatar).toEqual({ empty: true })
		expect(cleared.imageMeta?.fullbody).toEqual({ empty: true })
	})

	test("setImage refuses to write when readOnly is true", async () => {
		const readOnlySvc = createCharacterService({
			db: dbh.db,
			paths,
			readOnly: { current: true },
		})
		const c = await svc.create({ name: "Alice" })
		const source = join(root, "avatar.png")
		writeFileSync(source, "fake-image")

		await expect(
			readOnlySvc.setImage(c.id, "avatar", ".png", source),
		).rejects.toMatchObject({
			kind: "server.read_only_archive",
		})
	})
})
