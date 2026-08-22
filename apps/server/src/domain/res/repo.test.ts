import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { buildResourceRepository, type ResRepository } from "./repo.ts"

describe("resource repository seeded random ordering", () => {
	let dbh: DbHandles
	let repo: ResRepository
	const ids = Array.from(
		{ length: 12 },
		(_, i) => `res-${String(i).padStart(2, "0")}`,
	)

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
		repo = buildResourceRepository(dbh.db)
		for (const [i, id] of ids.entries()) {
			repo.insert(
				id,
				{ name: id, intro: "", contentPluginId: null, tagIds: [], charIds: [] },
				1000 + i,
				1,
			)
		}
	})

	afterEach(() => {
		dbh.close()
	})

	function listIds(seed: string | undefined, page = 1, size = ids.length) {
		return repo
			.listPage({
				trashed: false,
				query: undefined,
				page,
				size,
				random: true,
				seed,
			})
			.rows.map((row) => row.id)
	}

	test("the same seed yields an identical order across queries", () => {
		expect(listIds("alpha")).toEqual(listIds("alpha"))
	})

	test("different seeds return the same set in different orders", () => {
		const orders = new Set(
			["alpha", "beta", "gamma"].map((seed) => listIds(seed).join(",")),
		)
		expect(orders.size).toBeGreaterThan(1)
		expect([...listIds("alpha")].sort()).toEqual([...ids].sort())
	})

	test("pagination partitions the full set without gaps or duplicates", () => {
		const size = 5
		const seen: string[] = []
		for (let page = 1; page <= Math.ceil(ids.length / size); page++) {
			seen.push(...listIds("alpha", page, size))
		}
		expect(seen).toHaveLength(ids.length)
		expect([...seen].sort()).toEqual([...ids].sort())
		// Re-fetching a page returns the same slice.
		expect(listIds("alpha", 2, size)).toEqual(seen.slice(size, size * 2))
	})

	test("a missing seed falls back to a fixed default order", () => {
		expect(listIds(undefined)).toEqual(listIds(undefined))
		expect(listIds(undefined)).toEqual(listIds(""))
	})

	test("ids restricts rows and total to the given id set", () => {
		const page = repo.listPage({
			trashed: false,
			query: undefined,
			page: 1,
			size: ids.length,
			ids: [ids[0] ?? "", ids[3] ?? "", "res-missing"],
		})
		expect(page.total).toBe(2)
		expect([...page.rows.map((row) => row.id)].sort()).toEqual(
			[ids[0], ids[3]].sort(),
		)
	})
})

describe("resource repository memories", () => {
	let dbh: DbHandles
	let repo: ResRepository

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
		repo = buildResourceRepository(dbh.db)
	})

	afterEach(() => {
		dbh.close()
	})

	function insertRes(id: string, createdAt: number): void {
		repo.insert(
			id,
			{ name: id, intro: "", contentPluginId: null, tagIds: [], charIds: [] },
			createdAt,
			1,
		)
	}

	function tsOf(year: number, month: number, day: number, hour = 0): number {
		return Date.UTC(year, month - 1, day, hour)
	}

	function memoryIds(
		month: number,
		day: number,
		offsetMin: number,
		limit = 24,
	): readonly string[] {
		return repo.memories({ month, day, offsetMin, limit }).map((row) => row.id)
	}

	test("matches month-day across previous years, newest first, excluding the current year", () => {
		const year = new Date().getUTCFullYear()
		insertRes("res-last-year", tsOf(year - 1, 6, 12))
		insertRes("res-three-years", tsOf(year - 3, 6, 12))
		insertRes("res-other-day", tsOf(year - 2, 6, 13))
		insertRes("res-current-year", tsOf(year, 6, 12))

		expect(memoryIds(6, 12, 0)).toEqual(["res-last-year", "res-three-years"])
	})

	test("excludes soft-deleted resources", () => {
		const year = new Date().getUTCFullYear()
		insertRes("res-live", tsOf(year - 1, 6, 12))
		insertRes("res-deleted", tsOf(year - 2, 6, 12))
		repo.patch("res-deleted", { deletedAt: tsOf(year - 1, 1, 1) })

		expect(memoryIds(6, 12, 0)).toEqual(["res-live"])
	})

	test("respects the limit", () => {
		const year = new Date().getUTCFullYear()
		insertRes("res-a", tsOf(year - 1, 6, 12))
		insertRes("res-b", tsOf(year - 2, 6, 12))
		insertRes("res-c", tsOf(year - 3, 6, 12))

		expect(memoryIds(6, 12, 0, 2)).toEqual(["res-a", "res-b"])
	})

	test("the offset interprets createdAt in the user's calendar day", () => {
		const year = new Date().getUTCFullYear()
		// 18:00 UTC on 06-12 is 02:00 local on 06-13 for UTC+8.
		insertRes("res-east-evening", tsOf(year - 1, 6, 12, 18))

		expect(memoryIds(6, 13, 480)).toEqual(["res-east-evening"])
		expect(memoryIds(6, 12, 480)).toEqual([])
		expect(memoryIds(6, 13, 0)).toEqual([])
	})

	test("is empty when nothing matches", () => {
		const year = new Date().getUTCFullYear()
		insertRes("res-other-day", tsOf(year - 1, 1, 1))

		expect(memoryIds(12, 25, 0)).toEqual([])
	})
})

describe("resource repository source search, filter, and aggregation", () => {
	let dbh: DbHandles
	let repo: ResRepository

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
		repo = buildResourceRepository(dbh.db)
	})

	afterEach(() => {
		dbh.close()
	})

	function insertRes(
		id: string,
		extra: { readonly sourceName?: string; readonly name?: string } = {},
	): void {
		repo.insert(
			id,
			{
				name: extra.name ?? id,
				intro: "",
				sourceName: extra.sourceName ?? null,
				contentPluginId: null,
				tagIds: [],
				charIds: [],
			},
			1000,
			1,
		)
	}

	function listIds(query: string | undefined, sourceName?: string) {
		return repo
			.listPage({
				trashed: false,
				query,
				page: 1,
				size: 100,
				sourceName,
			})
			.rows.map((row) => row.id)
	}

	test("the free-text query matches the source name as well as the display name", () => {
		insertRes("res-source", { sourceName: "ExampleSite" })
		insertRes("res-name", { name: "example-named" })
		insertRes("res-other")

		expect(listIds("example")).toEqual(
			expect.arrayContaining(["res-source", "res-name"]),
		)
		expect(listIds("example")).not.toContain("res-other")
	})

	test("the sourceName filter matches exactly", () => {
		insertRes("res-a", { sourceName: "ExampleSite" })
		insertRes("res-b", { sourceName: "exampleSite" })
		insertRes("res-c", { sourceName: "OtherSite" })

		expect(listIds(undefined, "ExampleSite")).toEqual(["res-a"])
		expect(listIds(undefined, "OtherSite")).toEqual(["res-c"])
	})

	test("listSourceNames aggregates live resources, most used first", () => {
		insertRes("res-a", { sourceName: "SecondSite" })
		insertRes("res-b", { sourceName: "FirstSite" })
		insertRes("res-c", { sourceName: "FirstSite" })
		insertRes("res-d", { sourceName: "FirstSite" })
		insertRes("res-deleted", { sourceName: "FirstSite" })
		insertRes("res-empty", { sourceName: "" })
		insertRes("res-none")
		repo.patch("res-deleted", { deletedAt: 2000 })

		expect(repo.listSourceNames(10)).toEqual([
			{ name: "FirstSite", count: 3 },
			{ name: "SecondSite", count: 1 },
		])
	})

	test("listSourceNames respects the limit", () => {
		insertRes("res-a", { sourceName: "SiteA" })
		insertRes("res-b", { sourceName: "SiteB" })
		insertRes("res-c", { sourceName: "SiteC" })

		expect(repo.listSourceNames(2)).toEqual([
			{ name: "SiteA", count: 1 },
			{ name: "SiteB", count: 1 },
		])
	})
})
