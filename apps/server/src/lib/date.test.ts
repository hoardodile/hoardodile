import { describe, expect, test } from "vitest"
import { formatTimestamp } from "./date.ts"

describe("formatTimestamp", () => {
	test("defaults to UTC", () => {
		const ts = Date.UTC(2024, 5, 12, 14, 30, 0)
		expect(formatTimestamp(ts)).toBe("2024-06-12 14:30:00")
	})

	test("formats in an explicit IANA zone", () => {
		const ts = Date.UTC(2024, 5, 11, 16, 30, 0)
		expect(formatTimestamp(ts, "Asia/Shanghai")).toBe("2024-06-12 00:30:00")
	})

	test("falls back to UTC for invalid IANA zones", () => {
		const ts = Date.UTC(2024, 5, 12, 14, 30, 0)
		expect(formatTimestamp(ts, "Not/AZone")).toBe("2024-06-12 14:30:00")
	})
})
