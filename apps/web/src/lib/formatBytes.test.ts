/**
 * @vitest-environment node
 */

import { describe, expect, test } from "vitest"
import { formatBytes } from "./formatBytes.ts"

describe("formatBytes", () => {
	test("returns empty string for undefined", () => {
		expect(formatBytes(undefined)).toBe("")
	})

	test("clamps non-positive and non-finite values to 0 B", () => {
		expect(formatBytes(0)).toBe("0 B")
		expect(formatBytes(-1)).toBe("0 B")
		expect(formatBytes(Number.NaN)).toBe("0 B")
		expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B")
	})

	test("uses 1024-based conversion with JEDEC labels", () => {
		expect(formatBytes(1024)).toBe("1 KB")
		expect(formatBytes(1536)).toBe("1.5 KB")
		expect(formatBytes(1024 ** 2)).toBe("1 MB")
		expect(formatBytes(1024 ** 3)).toBe("1 GB")
	})
})
