import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq, sql } from "drizzle-orm"
import { categories } from "src/domain/cat/schema.ts"
import { characters } from "src/domain/char/schema.ts"
import { createCharacterService } from "src/domain/char/service.ts"
import { createResourceService } from "src/domain/res/service.ts"
import { createTestHooks } from "src/domain/res/test-registry.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { migrationRuns } from "src/infra/db/runs-schema.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
	DEFAULT_NAMESPACE_NAME,
	hasPreRewriteTagSchema,
	hasTagRuleTables,
	runPreMigrationTagDedupe,
	runTagDedupe,
	TAG_DEDUPE_RUN_NAME,
} from "./dedupe.ts"
import { parentRules, resTags, siblingPairs, tags } from "./schema.ts"

/**
 * The dedupe cleans up data that the service layer now refuses to create
 * (duplicate names, duplicate tags), so fixtures insert rows directly,
 * bypassing the uniqueness checks — exactly like a pre-rewrite database.
 */
describe("tag dedupe", () => {
	let root: string
	let dbh: DbHandles
	let resIds: string[]

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "app-dedupe-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
		// Simulate a pre-rewrite database: the unique name indexes are not
		// there yet, so duplicate rows can exist (the dedupe's whole job).
		dbh.db.run(sql`DROP INDEX IF EXISTS tags_category_name_unique`)
		dbh.db.run(sql`DROP INDEX IF EXISTS categories_name_unique`)
		const paths = createStoragePaths({ root })
		const resSvc = createResourceService({
			db: dbh.db,
			paths,
			readOnly: { current: false },
			pluginHooks: createTestHooks(),
		})
		const charSvc = createCharacterService({
			db: dbh.db,
			paths,
			readOnly: { current: false },
		})
		const r1 = await resSvc.create({ name: "r1" })
		const r2 = await resSvc.create({ name: "r2" })
		resIds = [r1.id, r2.id]
		await charSvc.create({ name: "c1" })
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	function insertCat(
		name: string,
		createdAt: number,
		kind: "common" | "resource" | "character" = "common",
	): string {
		const id = `cat-${Math.random().toString(36).slice(2)}`
		dbh.db
			.insert(categories)
			.values({
				id,
				name,
				intro: "",
				color: "",
				kind,
				position: 0,
				pinned: false,
				createdAt,
				updatedAt: createdAt,
			})
			.run()
		return id
	}

	function insertTag(
		catId: string | null,
		name: string,
		createdAt: number,
	): string {
		const id = `tag-${Math.random().toString(36).slice(2)}`
		dbh.db
			.insert(tags)
			.values({
				id,
				name,
				intro: "",
				color: "",
				position: 0,
				pinned: false,
				catId,
				createdAt,
				updatedAt: createdAt,
			})
			.run()
		return id
	}

	function attachRes(tagId: string, resId: string): void {
		dbh.db.insert(resTags).values({ resId, tagId }).onConflictDoNothing().run()
	}

	async function attachedResourceIds(): Promise<string[]> {
		return (await dbh.db.select().from(resTags).all()).map((r) => r.resId)
	}

	function recordedRunCount(): number {
		return (
			dbh.db
				.select({ value: sql<number>`count(*)` })
				.from(migrationRuns)
				.where(eq(migrationRuns.name, TAG_DEDUPE_RUN_NAME))
				.get()?.value ?? 0
		)
	}

	test("fresh database: records a no-op run, then skips forever", () => {
		const first = runTagDedupe(dbh.db)
		expect(first).toMatchObject({
			skipped: false,
			namespacesMerged: 0,
			tagsMerged: 0,
			orphansMoved: 0,
		})
		expect(recordedRunCount()).toBe(1)
		expect(runTagDedupe(dbh.db).skipped).toBe(true)
	})

	test("merges namespaces whose trimmed names collide", () => {
		const catA = insertCat("Music", 1)
		const catB = insertCat(" Music ", 2)
		const t1 = insertTag(catA, "rock", 1)
		const t2 = insertTag(catA, "jazz", 2)
		const t3 = insertTag(catB, "blues", 3)

		const run = runTagDedupe(dbh.db)
		expect(run.namespacesMerged).toBe(1)

		const remaining = dbh.db.select().from(categories).all()
		expect(remaining).toHaveLength(1)
		expect(remaining[0]?.id).toBe(catA)
		const allTags = dbh.db.select().from(tags).all()
		expect(allTags).toHaveLength(3)
		expect(allTags.every((t) => t.catId === catA)).toBe(true)
		expect(allTags.map((t) => t.id).sort()).toEqual([t1, t2, t3].sort())
	})

	test("merges duplicate tags, survivor is the most-used", async () => {
		const cat = insertCat("Music", 1)
		const loser = insertTag(cat, "rock", 1)
		const survivor = insertTag(cat, "rock", 2)
		// Two resources on the survivor, one on the loser: usage wins over
		// the earlier-created loser.
		attachRes(survivor, resIds[0] ?? "")
		attachRes(survivor, resIds[1] ?? "")
		attachRes(loser, resIds[0] ?? "")

		const run = runTagDedupe(dbh.db)
		expect(run.tagsMerged).toBe(1)

		const remaining = dbh.db.select().from(tags).all()
		expect(remaining).toHaveLength(1)
		expect(remaining[0]?.id).toBe(survivor)
		expect((await attachedResourceIds()).sort()).toEqual([...resIds].sort())
	})

	test("duplicate tags with no usages keep the earliest-created survivor", () => {
		const cat = insertCat("Music", 1)
		const early = insertTag(cat, "jazz", 1)
		const late = insertTag(cat, "jazz", 2)

		const run = runTagDedupe(dbh.db)
		expect(run.tagsMerged).toBe(1)
		expect(
			dbh.db
				.select()
				.from(tags)
				.all()
				.map((t) => t.id),
		).toEqual([early])
		expect(early).not.toBe(late)
	})

	test("moves orphan tags into the default namespace", () => {
		const cat = insertCat("Music", 1)
		insertTag(cat, "kept", 1)
		const orphan = insertTag(null, "lost", 2)

		const run = runTagDedupe(dbh.db)
		expect(run.orphansMoved).toBe(1)
		expect(run.defaultNamespaceCreated).toBe(true)
		const moved = dbh.db
			.select({ catId: tags.catId })
			.from(tags)
			.where(eq(tags.id, orphan))
			.get()
		const ns = dbh.db
			.select()
			.from(categories)
			.where(eq(categories.name, DEFAULT_NAMESPACE_NAME))
			.get()
		expect(moved?.catId).toBe(ns?.id)
	})

	test("dry-run changes nothing and does not record", () => {
		const cat = insertCat("Music", 1)
		// No usages anywhere: the earliest-created tag wins.
		const survivor = insertTag(cat, "rock", 1)
		const loser = insertTag(cat, "rock", 2)

		const run = runTagDedupe(dbh.db, { dryRun: true })
		expect(run.tagsMerged).toBe(1)
		expect(dbh.db.select().from(tags).all()).toHaveLength(2)
		expect(loser).toBeDefined()
		expect(recordedRunCount()).toBe(0)

		// A real run afterwards still executes (and records).
		const real = runTagDedupe(dbh.db)
		expect(real.tagsMerged).toBe(1)
		expect(
			dbh.db
				.select()
				.from(tags)
				.all()
				.map((t) => t.id),
		).toEqual([survivor])
	})

	test("pre-migration pass merges duplicates without touching rules", async () => {
		const cat = insertCat("Music", 1)
		// The later-created tag wins because it is the one in use.
		const survivor = insertTag(cat, "rock", 2)
		insertTag(cat, "rock", 1)
		attachRes(survivor, resIds[0] ?? "")

		const run = runPreMigrationTagDedupe(dbh.db)
		expect(run.tagsMerged).toBe(1)
		expect(run.skipped).toBe(false)
		expect(
			dbh.db
				.select()
				.from(tags)
				.all()
				.map((t) => t.id),
		).toEqual([survivor])
		expect((await attachedResourceIds()).sort()).toEqual(
			[resIds[0] ?? ""].sort(),
		)
		// Pre-migration passes never record.
		expect(recordedRunCount()).toBe(0)
	})

	test("clean duplicates before index creation succeeds (ordering guarantee)", () => {
		const cat = insertCat("Music", 1)
		insertTag(cat, "rock", 1)
		insertTag(cat, "rock", 2)

		runPreMigrationTagDedupe(dbh.db)

		// The migration's index creation must now succeed on the cleaned data.
		expect(() => {
			dbh.db.run(
				sql`CREATE UNIQUE INDEX categories_name_unique ON categories (name)`,
			)
			dbh.db.run(
				sql`CREATE UNIQUE INDEX tags_category_name_unique ON tags (category_id, name)`,
			)
		}).not.toThrow()
	})

	test("hasTagRuleTables distinguishes legacy from migrated databases", () => {
		expect(hasTagRuleTables(dbh.db)).toBe(true)
		const raw = openDb(":memory:")
		expect(hasTagRuleTables(raw.db)).toBe(false)
		raw.close()
	})

	test("post-migration dedupe migrates existing sibling rules onto the survivor", () => {
		const cat = insertCat("Music", 1)
		// The later-created tag wins because it is the one in use.
		const survivor = insertTag(cat, "rock", 2)
		const loser = insertTag(cat, "rock", 1)
		const other = insertTag(cat, "jazz", 3)
		attachRes(survivor, resIds[0] ?? "")
		// The loser carries a sibling pair; merging must carry it over.
		dbh.db
			.insert(siblingPairs)
			.values({ badId: loser, goodId: other, createdAt: 1 })
			.run()

		const run = runTagDedupe(dbh.db)
		expect(run.tagsMerged).toBe(1)
		expect(run.skipped).toBe(false)
		const pairs = dbh.db
			.select()
			.from(siblingPairs)
			.all()
			.map((p) => [p.badId, p.goodId])
		expect(pairs).toEqual([[other, survivor]])
		// The post-migration pass records its run.
		expect(recordedRunCount()).toBe(1)
	})

	test("post-migration dedupe merges duplicates while migrating character rules", () => {
		const cat = insertCat("Cast", 1)
		// The earliest-created tag wins the tie (both unused).
		const survivor = insertTag(cat, "rock", 1)
		const loser = insertTag(cat, "rock", 2)
		const charId = "char-rule-1"
		dbh.db
			.insert(characters)
			.values({
				id: charId,
				name: "Ria",
				intro: "",
				traitValues: "{}",
				avatarVersion: 1,
				fullbodyVersion: 1,
				createdAt: 1,
				updatedAt: 1,
			})
			.run()
		// The loser is the display tag of a character link and the parent
		// of a character-child rule; both must follow it onto the survivor.
		dbh.db
			.insert(siblingPairs)
			.values({
				badKind: "character",
				badId: null,
				badCharacterId: charId,
				goodId: loser,
				createdAt: 1,
			})
			.run()
		dbh.db
			.insert(parentRules)
			.values({
				childKind: "character",
				childId: null,
				childCharacterId: charId,
				parentId: loser,
				createdAt: 1,
			})
			.run()

		const run = runTagDedupe(dbh.db)
		expect(run.tagsMerged).toBe(1)
		expect(run.skipped).toBe(false)
		const pairs = dbh.db
			.select()
			.from(siblingPairs)
			.all()
			.map((p) => [p.badKind, p.badCharacterId, p.goodId])
		expect(pairs).toEqual([["character", charId, survivor]])
		const rules = dbh.db
			.select()
			.from(parentRules)
			.all()
			.map((r) => [r.childKind, r.childCharacterId, r.parentId])
		expect(rules).toEqual([["character", charId, survivor]])
	})

	test("hasPreRewriteTagSchema only matches the in-between schema state", () => {
		// Fully migrated: false.
		expect(hasPreRewriteTagSchema(dbh.db)).toBe(false)
		// Fresh, nothing migrated: false.
		const raw = openDb(":memory:")
		expect(hasPreRewriteTagSchema(raw.db)).toBe(false)
		// Pre-rewrite state (tag tables exist, rule tables do not): true.
		dbh.db.run(sql`DROP TABLE sibling_pairs`)
		dbh.db.run(sql`DROP TABLE parent_rules`)
		expect(hasPreRewriteTagSchema(dbh.db)).toBe(true)
		raw.close()
	})
})
