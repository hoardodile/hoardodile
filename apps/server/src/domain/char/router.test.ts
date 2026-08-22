import { describe, expect, test } from "vitest"
import { buildCharacterRouter } from "./router.ts"

describe("character router contract", () => {
	// Both bulk lookups carry large id sets, so they ride in POST bodies via
	// mutations; the single-character lookups stay GET queries.
	test("byIds and listCharactershipsForCharacters are mutations", () => {
		const router = buildCharacterRouter({} as never)
		expect(router._def.record.byIds._def.type).toBe("mutation")
		expect(router._def.record.listCharactershipsForCharacters._def.type).toBe(
			"mutation",
		)
		expect(router._def.record.detail._def.type).toBe("query")
		expect(router._def.record.listCharacterships._def.type).toBe("query")
	})
})
