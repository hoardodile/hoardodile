import { sql } from "drizzle-orm"
import { expect, test } from "vitest"
import { openDb } from "./connection.ts"

test("migrations run on a fresh in-memory database", () => {
	const h = openDb(":memory:")
	try {
		h.runMigrations()

		const tables = h.db.all<{ name: string }>(
			sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
		)
		const names = tables.map((t) => t.name)
		expect(names).toContain("auth")
		expect(names).toContain("resources")
		expect(names).toContain("characters")
		expect(names).toContain("relationship_types")
		expect(names).toContain("characterships")
		expect(names).toContain("documents")
		expect(names).toContain("document_versions")
		expect(names).toContain("categories")
		expect(names).toContain("tags")
		expect(names).toContain("resource_tags")
		expect(names).toContain("character_tags")
		expect(names).toContain("trait_defs")
		// Drizzle Kit stores its bookkeeping under this name.
		expect(names).toContain("__drizzle_migrations")
	} finally {
		h.close()
	}
})
