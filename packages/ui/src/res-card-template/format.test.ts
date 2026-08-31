/**
 * @vitest-environment node
 */

import { describe, expect, test } from "vitest"
import { formatBytes, formatClockDuration } from "./index.ts"

describe("formatBytes", () => {
	test("returns empty for undefined", () => {
		expect(formatBytes(undefined)).toBe("")
	})

	test("clamps zero, negative and non-finite to 0 B", () => {
		expect(formatBytes(0)).toBe("0 B")
		expect(formatBytes(-1)).toBe("0 B")
		expect(formatBytes(Number.NaN)).toBe("0 B")
		expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B")
	})

	test("formats kibibytes with JEDEC labels", () => {
		expect(formatBytes(1024)).toBe("1 KB")
		expect(formatBytes(1536)).toBe("1.5 KB")
	})

	test("formats megabytes and gigabytes", () => {
		expect(formatBytes(1024 ** 2)).toBe("1 MB")
		expect(formatBytes(1024 ** 3)).toBe("1 GB")
	})
})

describe("formatClockDuration", () => {
	test("formats sub-hour as m:ss", () => {
		expect(formatClockDuration(0)).toBe("0:00")
		expect(formatClockDuration(125_000)).toBe("2:05")
	})

	test("formats past the hour as h:mm:ss", () => {
		expect(formatClockDuration(3_661_000)).toBe("1:01:01")
	})

	test("returns empty for negative or non-finite input", () => {
		expect(formatClockDuration(-1)).toBe("")
		expect(formatClockDuration(Number.NaN)).toBe("")
	})
})
