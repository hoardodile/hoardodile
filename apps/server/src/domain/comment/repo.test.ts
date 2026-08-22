import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { buildCommentRepository, type CommentRepository } from "./repo.ts"

/**
 * Repo-level coverage for `listRepliesFor`. The recursive-CTE that
 * powers this query is the only place in production code where ids are
 * interpolated into raw SQL today; these tests pin the observable
 * behavior so the upcoming switch to parameter binding stays a no-op
 * for callers.
 */
describe("commentRepository.listRepliesFor", () => {
	let dbh: DbHandles
	let repo: CommentRepository

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
		repo = buildCommentRepository(dbh.db)
	})

	afterEach(() => {
		dbh.close()
	})

	function seed(id: string, parentId: string | null, ts: number): void {
		repo.insert(
			id,
			{
				parentId,
				body: `body-${id}`,
				deletedAt: null,
				floor: null,
				anchor: undefined,
				anchorResId: undefined,
			},
			ts,
		)
	}

	test("returns [] for an empty parentIds list", () => {
		seed("root", null, 1000)
		seed("r1", "root", 1100)
		expect(repo.listRepliesFor([])).toEqual([])
	})

	test("returns [] when the parent has no replies", () => {
		seed("root", null, 1000)
		expect(repo.listRepliesFor(["root"])).toEqual([])
	})

	test("returns direct replies for a single parent, ordered by createdAt asc", () => {
		seed("root", null, 1000)
		seed("r2", "root", 1300)
		seed("r1", "root", 1100)
		seed("r3", "root", 1500)

		const rows = repo.listRepliesFor(["root"])
		expect(rows.map((r) => r.id)).toEqual(["r1", "r2", "r3"])
	})

	test("recursively expands replies of replies three levels deep", () => {
		seed("root", null, 1000)
		seed("a", "root", 1100)
		seed("a.1", "a", 1200)
		seed("a.1.1", "a.1", 1300)

		const rows = repo.listRepliesFor(["root"])
		expect(rows.map((r) => r.id)).toEqual(["a", "a.1", "a.1.1"])
	})

	test("returns descendants from multiple parent seeds in one call", () => {
		seed("rootA", null, 1000)
		seed("rootB", null, 1100)
		seed("a1", "rootA", 1200)
		seed("b1", "rootB", 1300)
		seed("a1.1", "a1", 1400)

		const rows = repo.listRepliesFor(["rootA", "rootB"])
		expect(rows.map((r) => r.id).sort()).toEqual(["a1", "a1.1", "b1"])
	})

	test("handles parent ids that contain single quotes", () => {
		const trickyId = "comment-with-'apostrophe"
		seed(trickyId, null, 1000)
		seed("reply-of-tricky", trickyId, 1100)

		const rows = repo.listRepliesFor([trickyId])
		expect(rows.map((r) => r.id)).toEqual(["reply-of-tricky"])
	})

	test("ignores siblings outside the requested subtree", () => {
		seed("rootA", null, 1000)
		seed("rootB", null, 1100)
		seed("a1", "rootA", 1200)
		seed("b1", "rootB", 1300)

		const rows = repo.listRepliesFor(["rootA"])
		expect(rows.map((r) => r.id)).toEqual(["a1"])
	})

	test("orders mixed-depth descendants strictly by createdAt asc", () => {
		seed("root", null, 1000)
		seed("late-direct", "root", 5000)
		seed("early-child", "root", 1100)
		seed("middle-grandchild", "early-child", 1200)
		seed("earliest-greatgrandchild", "middle-grandchild", 1150)

		const rows = repo.listRepliesFor(["root"])
		expect(rows.map((r) => r.id)).toEqual([
			"early-child",
			"earliest-greatgrandchild",
			"middle-grandchild",
			"late-direct",
		])
	})
})
