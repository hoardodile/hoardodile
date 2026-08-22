import { describe, expect, test } from "vitest"
import {
	formatUsagePeriod,
	getUsageDayBounds,
	requireIanaTimeZone,
} from "./usage-period.ts"

describe("requireIanaTimeZone", () => {
	test("rejects local sentinel", () => {
		expect(() => getUsageDayBounds("2026-06-15", "local")).toThrow(
			/timeZone must be a resolved IANA zone/,
		)
	})

	test("rejects invalid IANA zone names", () => {
		expect(() => getUsageDayBounds("2026-06-15", "Foo/Bar")).toThrow(
			/timeZone must be a valid IANA zone/,
		)
	})

	test("rejects undefined", () => {
		expect(() => requireIanaTimeZone(undefined)).toThrow(
			/timeZone is required for period-bound usage queries/,
		)
	})
})

describe("getUsageDayBounds", () => {
	test("returns Shanghai calendar day boundaries in UTC milliseconds", () => {
		const { start, end } = getUsageDayBounds("2026-06-15", "Asia/Shanghai")
		expect(start).toBe(Date.UTC(2026, 5, 14, 16, 0, 0))
		expect(end).toBe(Date.UTC(2026, 5, 15, 16, 0, 0))
	})

	test("returns UTC calendar day boundaries", () => {
		const { start, end } = getUsageDayBounds("2026-06-15", "UTC")
		expect(start).toBe(Date.UTC(2026, 5, 15, 0, 0, 0))
		expect(end).toBe(Date.UTC(2026, 5, 16, 0, 0, 0))
	})
})

describe("formatUsagePeriod", () => {
	const ts = Date.UTC(2026, 5, 15, 4, 30, 0)

	test("formats day/week/month/year in zone", () => {
		expect(formatUsagePeriod(ts, "day", "Asia/Shanghai")).toBe("2026-06-15")
		expect(formatUsagePeriod(ts, "week", "Asia/Shanghai")).toMatch(
			/^2026-W\d{2}$/,
		)
		expect(formatUsagePeriod(ts, "month", "Asia/Shanghai")).toBe("2026-06")
		expect(formatUsagePeriod(ts, "year", "Asia/Shanghai")).toBe("2026")
	})
})
