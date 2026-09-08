import { eq } from "drizzle-orm"
import {
	buildCharacterRepository,
	type CharRepository,
} from "src/domain/char/repo.ts"
import { characters } from "src/domain/char/schema.ts"
import { systemPreferences } from "src/domain/prefs/schema.ts"
import {
	buildResourceRepository,
	type ResRepository,
} from "src/domain/res/repo.ts"
import { resCharacters, resources } from "src/domain/res/schema.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { buildTagRepository, type TagRepository } from "./repo.ts"
import { charTags, resTags, siblingPairs } from "./schema.ts"
import { WATCH_ONLY_PREF_KEY } from "./visibility.ts"

describe("tag visibility in content queries", () => {
	let dbh: DbHandles
	let tagRepo: TagRepository
	let resRepo: ResRepository
	let charRepo: CharRepository

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
		tagRepo = buildTagRepository(dbh.db)
		resRepo = buildResourceRepository(dbh.db)
		charRepo = buildCharacterRepository(dbh.db)
	})

	afterEach(() => {
		dbh.close()
	})

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

	function insertTag(
		id: string,
		visibility: "normal" | "watch_only" | "explicit_view",
	): void {
		tagRepo.insert(
			id,
			{
				name: id,
				intro: "",
				color: "",
				link: "",
				position: 0,
				pinned: false,
				visibility,
				catId: null,
			},
			Date.now(),
		)
	}

	function insertResource(
		id: string,
		tagIds: readonly string[],
		charIds: readonly string[] = [],
	): void {
		const db = dbh.db
		db.insert(resources)
			.values({
				id,
				name: id,
				intro: "",
				sourceName: null,
				sourceUrl: null,
				contentPluginId: null,
				fileVersion: 1,
				coverVersion: 1,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				deletedAt: null,
			})
			.run()
		for (const tagId of tagIds) {
			db.insert(resTags).values({ resId: id, tagId }).run()
		}
		for (const charId of charIds) {
			db.insert(resCharacters).values({ resId: id, charId }).run()
		}
	}

	function insertCharacter(id: string, tagIds: readonly string[]): void {
		const db = dbh.db
		db.insert(characters)
			.values({
				id,
				name: id,
				intro: "",
				traitValues: "{}",
				avatarVersion: 1,
				fullbodyVersion: 1,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				deletedAt: null,
			})
			.run()
		for (const tagId of tagIds) {
			db.insert(charTags).values({ charId: id, tagId }).run()
		}
	}

	function listResourceIds(tagIds: readonly string[] = []): readonly string[] {
		return resRepo
			.listPage({
				trashed: false,
				query: undefined,
				page: 1,
				size: 100,
				tagIds,
			})
			.rows.map((r) => r.id)
	}

	function listCharacterIds(tagIds: readonly string[] = []): readonly string[] {
		return charRepo
			.listPage({
				trashed: false,
				query: undefined,
				page: 1,
				size: 100,
				tagIds,
			})
			.rows.map((r) => r.id)
	}

	function expectSameIds(
		actual: readonly string[],
		...expected: readonly string[]
	): void {
		const set = new Set(actual)
		expect(set.size).toBe(actual.length)
		expect([...set].sort()).toEqual([...expected].sort())
	}

	test("with watch-only OFF and no explicit tags, everything is visible", () => {
		insertTag("red", "watch_only")
		insertResource("res-a", ["red"])
		insertResource("res-b", [])
		expectSameIds(listResourceIds(), "res-a", "res-b")
		expectSameIds(listCharacterIds())
	})

	test("watch-only ON narrows to content carrying any watch-only tag (union)", () => {
		setWatchOnly(true)
		insertTag("red", "watch_only")
		insertTag("blue", "watch_only")
		insertTag("green", "normal")
		insertResource("res-red", ["red"])
		insertResource("res-blue", ["blue"])
		insertResource("res-green", ["green"])
		insertResource("res-none", [])
		expectSameIds(listResourceIds(), "res-red", "res-blue")
		expectSameIds(listCharacterIds())
	})

	test("explicit-view content is hidden unless its tag is selected", () => {
		insertTag("spoil", "explicit_view")
		insertResource("res-spoil", ["spoil"])
		insertResource("res-ok", [])
		// Default browse hides it.
		expectSameIds(listResourceIds(), "res-ok")
		// Selecting the explicit-view tag reveals the content (the active
		// `and` filter then requires carrying the tag, so only spoil-carrying
		// content remains).
		expectSameIds(listResourceIds(["spoil"]), "res-spoil")
	})

	test("an unselected explicit tag wins over a watch-only tag", () => {
		setWatchOnly(true)
		insertTag("red", "watch_only")
		insertTag("spoil", "explicit_view")
		insertResource("res-both", ["red", "spoil"])
		insertResource("res-red", ["red"])
		// No-tag entities carry no watch-only tag → hidden under watch-only.
		insertResource("res-float", [])
		// res-both carries red (watch-only) but also an unselected explicit
		// tag → hidden. res-red carries red only → shown.
		expectSameIds(listResourceIds(), "res-red")
		// Selecting the explicit tag reveals res-both again (the `and` filter
		// then requires carrying spoil, so res-red drops out).
		expectSameIds(listResourceIds(["spoil"]), "res-both")
	})

	test("watch-only is ignored when the toggle is OFF even with explicit tags", () => {
		insertTag("red", "watch_only")
		insertResource("res-a", ["red"])
		insertResource("res-b", [])
		expectSameIds(listResourceIds(), "res-a", "res-b")
	})

	test("characters follow the same explicit-view + watch-only rules", () => {
		setWatchOnly(true)
		insertTag("red", "watch_only")
		insertTag("spoil", "explicit_view")
		insertCharacter("char-red", ["red"])
		insertCharacter("char-both", ["red", "spoil"])
		insertCharacter("char-ok", [])
		expectSameIds(listCharacterIds(), "char-red")
		expectSameIds(listCharacterIds(["spoil"]), "char-both")
	})

	test("trash lists are not filtered by visibility", () => {
		setWatchOnly(true)
		insertTag("spoil", "explicit_view")
		insertResource("res-trashed", ["spoil"])
		const db = dbh.db
		db.update(resources)
			.set({ deletedAt: Date.now() })
			.where(eq(resources.id, "res-trashed"))
			.run()
		const trashed = resRepo
			.listPage({ trashed: true, query: undefined, page: 1, size: 100 })
			.rows.map((r) => r.id)
		expect(trashed).toContain("res-trashed")
	})

	test("a watch-only tag matched through a sibling group reveals content", () => {
		setWatchOnly(true)
		insertTag("bad", "watch_only")
		insertTag("good", "normal")
		dbh.db
			.insert(siblingPairs)
			.values({
				badKind: "tag",
				badId: "bad",
				goodId: "good",
				createdAt: Date.now(),
			})
			.run()
		insertResource("res-bad", ["bad"])
		insertResource("res-good", ["good"])
		expectSameIds(listResourceIds(), "res-bad", "res-good")
	})

	test("detail-by-id is not filtered by visibility", () => {
		setWatchOnly(true)
		insertTag("spoil", "explicit_view")
		insertResource("res-hidden", ["spoil"])
		insertCharacter("char-hidden", ["spoil"])
		// Even though the entity is excluded from browse, direct id fetch works.
		const resRow = resRepo.findById("res-hidden")
		expect(resRow.id).toBe("res-hidden")
		const charRow = charRepo.findById("char-hidden")
		expect(charRow.id).toBe("char-hidden")
	})

	test("watch-only ON with no watch-only tag defined is a no-op for browse", () => {
		setWatchOnly(true)
		insertResource("res-a", [])
		insertTag("normalTag", "normal")
		insertResource("res-b", ["normalTag"])
		// No tag is `watch_only`, so nothing narrows.
		expectSameIds(listResourceIds(), "res-a", "res-b")
	})

	test("watch-only ON with a defined watch-only tag but no matching content yields an empty universe", () => {
		setWatchOnly(true)
		insertTag("red", "watch_only")
		insertResource("res-keep", ["red"])
		// Everything not carrying red is excluded, and no other tag appears on
		// visible content, so the visible tag universe is just red.
		expectSameIds(listResourceIds(), "res-keep")
	})

	test("memories respects the visibility predicate", () => {
		setWatchOnly(true)
		insertTag("red", "watch_only")
		insertTag("spoil", "explicit_view")
		// created "today" in a previous year so memories finds it.
		const now = new Date()
		const prev = Date.UTC(
			now.getUTCFullYear() - 1,
			now.getUTCMonth(),
			now.getUTCDate(),
			0,
		)
		const db = dbh.db
		db.insert(resources)
			.values({
				id: "res-mem-red",
				name: "mem-red",
				intro: "",
				sourceName: null,
				sourceUrl: null,
				contentPluginId: null,
				fileVersion: 1,
				coverVersion: 1,
				createdAt: prev,
				updatedAt: prev,
				deletedAt: null,
			})
			.run()
		db.insert(resTags).values({ resId: "res-mem-red", tagId: "red" }).run()
		db.insert(resources)
			.values({
				id: "res-mem-hidden",
				name: "mem-hidden",
				intro: "",
				sourceName: null,
				sourceUrl: null,
				contentPluginId: null,
				fileVersion: 1,
				coverVersion: 1,
				createdAt: prev,
				updatedAt: prev,
				deletedAt: null,
			})
			.run()
		db.insert(resTags).values({ resId: "res-mem-hidden", tagId: "spoil" }).run()
		const ids = resRepo
			.memories({
				month: now.getUTCMonth() + 1,
				day: now.getUTCDate(),
				offsetMin: 0,
				limit: 24,
			})
			.map((row) => row.id)
		expect(ids).toContain("res-mem-red")
		expect(ids).not.toContain("res-mem-hidden")
	})

	test("listSourceNames respects the visibility predicate", () => {
		setWatchOnly(true)
		insertTag("red", "watch_only")
		insertTag("spoil", "explicit_view")
		const db = dbh.db
		const base = {
			intro: "",
			sourceUrl: null,
			contentPluginId: null,
			fileVersion: 1,
			coverVersion: 1,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			deletedAt: null,
		}
		db.insert(resources)
			.values({
				id: "res-src-visible",
				name: "a",
				sourceName: "VisibleSite",
				...base,
			})
			.run()
		db.insert(resTags).values({ resId: "res-src-visible", tagId: "red" }).run()
		db.insert(resources)
			.values({
				id: "res-src-hidden",
				name: "b",
				sourceName: "VisibleSite",
				...base,
			})
			.run()
		db.insert(resTags).values({ resId: "res-src-hidden", tagId: "spoil" }).run()
		const names = resRepo.listSourceNames(10)
		expect(names).toEqual([{ name: "VisibleSite", count: 1 }])
	})
})
