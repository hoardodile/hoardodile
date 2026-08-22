import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { buildCharacterRepository, type CharRepository } from "./repo.ts"

describe("character repository seeded random ordering", () => {
	let dbh: DbHandles
	let repo: CharRepository
	const ids = Array.from(
		{ length: 12 },
		(_, i) => `char-${String(i).padStart(2, "0")}`,
	)

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
		repo = buildCharacterRepository(dbh.db)
		for (const [i, id] of ids.entries()) {
			repo.insert(
				id,
				{ name: id, intro: "", traitValues: "{}", tagIds: [] },
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
			ids: [ids[0] ?? "", ids[3] ?? "", "char-missing"],
		})
		expect(page.total).toBe(2)
		expect([...page.rows.map((row) => row.id)].sort()).toEqual(
			[ids[0], ids[3]].sort(),
		)
	})
})
