import { describe, expect, test } from "vitest"
import { buildResThumbCacheKey } from "./thumb-cache-key.ts"

describe("buildResThumbCacheKey", () => {
	test("uses updatedAt as the cache key", () => {
		const key = buildResThumbCacheKey({ updatedAt: 1_700_000_000_000 })
		expect(key).toBe("1700000000000")
	})
})
