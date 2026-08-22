import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
	buildUsageSessionsRepository,
	type UsageSessionsRepository,
} from "./repo.ts"

describe("usageSessionsRepository.findInRangeLight", () => {
	let dbh: DbHandles
	let repo: UsageSessionsRepository

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
		repo = buildUsageSessionsRepository(dbh.db)
	})

	afterEach(() => {
		dbh.close()
	})

	function insert(
		id: string,
		entityType: string,
		entityId: string,
		startedAt: number,
		endedAt: number,
		platform?: string,
	) {
		repo.upsert({
			id,
			entityType,
			entityId,
			startedAt,
			endedAt,
			durationMs: endedAt - startedAt,
			platform: platform ?? null,
			createdAt: endedAt,
			updatedAt: endedAt,
		})
	}

	test("returns only the bucketing columns", () => {
		insert("s1", "resource", "r1", 1_000, 2_000)
		insert("s2", "document", "d1", 3_000, 4_000)

		const rows = repo.findInRangeLight({ from: 0, to: 5_000 })
		expect(rows).toHaveLength(2)
		expect(rows[0]).toEqual({
			entityType: "resource",
			startedAt: 1_000,
			endedAt: 2_000,
		})
		expect(rows[1]).toEqual({
			entityType: "document",
			startedAt: 3_000,
			endedAt: 4_000,
		})
	})

	test("row set matches findInRange for the same filters", () => {
		const from = 10_000
		const to = 20_000
		insert("inside", "resource", "r1", 11_000, 12_000)
		insert("straddle", "resource", "r2", from - 1_000, to + 1_000)
		insert("before", "resource", "r3", 1_000, from - 1)
		insert("after", "resource", "r4", to + 1, to + 5_000)

		const project = (row: {
			entityType: string
			startedAt: number
			endedAt: number
		}) => ({
			entityType: row.entityType,
			startedAt: row.startedAt,
			endedAt: row.endedAt,
		})
		const light = repo
			.findInRangeLight({ from, to })
			.map(project)
			.sort((a, b) => a.startedAt - b.startedAt)
		const full = repo
			.findInRange({ from, to })
			.map(project)
			.sort((a, b) => a.startedAt - b.startedAt)

		expect(light).toEqual(full)
		expect(light.map((row) => row.entityType)).toEqual(["resource", "resource"])
	})

	test("includes overlap sessions and exact start/end boundary hits", () => {
		const from = 100_000
		const to = 200_000
		insert("straddles", "resource", "r1", from - 50_000, to + 50_000)
		// ended_at >= from: a session ending exactly at `from` counts.
		insert("endsAtFrom", "resource", "r2", from - 50_000, from)
		// started_at < to: a session starting exactly at `to` does not.
		insert("startsAtTo", "resource", "r3", to, to + 50_000)
		insert("before", "resource", "r4", 0, from - 1)
		insert("after", "resource", "r5", to + 1, to + 50_000)

		const rows = repo.findInRangeLight({ from, to })
		expect(rows.map((row) => row.endedAt).sort()).toEqual([from, to + 50_000])
	})

	test("filters by platform", () => {
		insert("pc", "resource", "r1", 1_000, 2_000, "web-pc")
		insert("mobile", "resource", "r2", 1_100, 2_100, "web-mobile")
		insert("none", "resource", "r3", 1_200, 2_200)

		const rows = repo.findInRangeLight({
			from: 0,
			to: 5_000,
			platform: "web-pc",
		})
		expect(rows).toHaveLength(1)
		expect(rows[0]?.startedAt).toBe(1_000)
	})

	test("empty range returns no rows", () => {
		insert("s1", "resource", "r1", 1_000, 2_000)

		expect(repo.findInRangeLight({ from: 3_000, to: 4_000 })).toEqual([])
		// The row starts after `to` — excluded even though it ends after `from`.
		expect(repo.findInRangeLight({ from: 0, to: 999 })).toEqual([])
	})
})
