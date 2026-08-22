import { openDb } from "src/infra/db/connection.ts"
import { expect, test } from "vitest"
import { buildAsyncPrefRepository, buildSystemPrefRepository } from "./repo.ts"

test("system pref repository only lists sync-scoped entries", () => {
	const h = openDb(":memory:")
	try {
		h.runMigrations()
		const syncRepo = buildSystemPrefRepository(h.db)
		const asyncRepo = buildAsyncPrefRepository(h.db)

		syncRepo.upsert("theme", "dark", 1)
		asyncRepo.upsert("document.treeExpanded", '["a"]', 2)

		const all = syncRepo.listAll()
		expect(all).toHaveLength(1)
		expect(all[0]).toEqual({
			key: "theme",
			scope: "sync",
			value: "dark",
			updatedAt: 1,
		})
	} finally {
		h.close()
	}
})

test("async pref repository stores and retrieves async-scoped entries", () => {
	const h = openDb(":memory:")
	try {
		h.runMigrations()
		const asyncRepo = buildAsyncPrefRepository(h.db)

		asyncRepo.upsert("document.blockPositions", '{"d1":"b1"}', 3)

		const entry = asyncRepo.get("document.blockPositions")
		expect(entry).toEqual({
			key: "document.blockPositions",
			scope: "async",
			value: '{"d1":"b1"}',
			updatedAt: 3,
		})
	} finally {
		h.close()
	}
})

test("migration scopes existing async keys to async", () => {
	const h = openDb(":memory:")
	try {
		h.runMigrations()
		// Insert rows using the async repository to simulate pre-migration
		// data that the migration would have tagged; then verify the sync
		// repository does not see them.
		const syncRepo = buildSystemPrefRepository(h.db)
		const asyncRepo = buildAsyncPrefRepository(h.db)

		asyncRepo.upsert("document.treeExpanded", '["a"]', 1)
		asyncRepo.upsert("document.blockPositions", '{"d1":"b1"}', 2)
		syncRepo.upsert("theme", "dark", 3)

		const syncAll = syncRepo.listAll()
		expect(syncAll).toHaveLength(1)
		expect(syncAll[0]?.key).toBe("theme")
		expect(asyncRepo.get("document.treeExpanded")?.scope).toBe("async")
		expect(asyncRepo.get("document.blockPositions")?.scope).toBe("async")
	} finally {
		h.close()
	}
})
