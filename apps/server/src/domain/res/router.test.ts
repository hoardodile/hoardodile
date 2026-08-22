import { describe, expect, test } from "vitest"
import { buildResourceRouter } from "./router.ts"

describe("resource router contract", () => {
	test("commitUpload procedure is no longer exposed", () => {
		const router = buildResourceRouter({} as never)
		expect(
			(router as unknown as Record<string, unknown>).commitUpload,
		).toBeUndefined()
	})

	// Bulk "only selected" listing rides in POST bodies via dedicated
	// mutations; the plain listings must stay GET-only queries.
	test("byIds card listings are mutations; plain listings stay queries", () => {
		const router = buildResourceRouter({} as never)
		expect(router._def.record.listCardsByIds._def.type).toBe("mutation")
		expect(router._def.record.trashListCardsByIds._def.type).toBe("mutation")
		expect(router._def.record.listCards._def.type).toBe("query")
		expect(router._def.record.trashListCards._def.type).toBe("query")
	})
})
