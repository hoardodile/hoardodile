/**
 * @vitest-environment node
 */

import { describe, expect, test, vi } from "vitest"
import {
	formatDayPeriodLabel,
	getRangeBounds,
	getRangeListTotalsInput,
	getRangePeriodSummary,
	getRangeTrend,
	rangeSupportsListTotals,
	toUsageTotalsInput,
} from "./date"

/** Server golden value for Asia/Shanghai 2026-06-15 local day. */
const SHANGHAI_JUNE_15_START = Date.UTC(2026, 5, 14, 16, 0, 0)
const SHANGHAI_JUNE_15_END = Date.UTC(2026, 5, 15, 16, 0, 0)

describe("formatDayPeriodLabel", () => {
	test("formats calendar day in explicit zone without local Date parsing", () => {
		expect(formatDayPeriodLabel("2024-06-12", "UTC")).toBe("06-12")
		expect(formatDayPeriodLabel("2024-06-12", "Asia/Shanghai")).toBe("06-12")
	})

	test("labels midnight boundary day in Tokyo, not shifted by host local", () => {
		// 2024-06-11 15:00 UTC is still 2024-06-12 in Tokyo (+9)
		expect(formatDayPeriodLabel("2024-06-12", "Asia/Tokyo")).toBe("06-12")
	})
})

describe("getRangePeriodSummary", () => {
	test("last7days has no single period summary", () => {
		expect(getRangePeriodSummary("last7days", "Asia/Shanghai")).toBeNull()
	})

	test("getRangeListTotalsInput falls back to calendar bounds for last7days", () => {
		expect(rangeSupportsListTotals("last7days")).toBe(false)
		expect(rangeSupportsListTotals("thisWeek")).toBe(true)
		const listTotals = getRangeListTotalsInput("last7days", "Asia/Shanghai")
		expect(listTotals).toEqual({
			from: expect.any(Number),
			to: expect.any(Number),
		})
		if ("from" in listTotals) {
			expect(listTotals.from).toBeLessThan(listTotals.to)
		}
	})
})

describe("getRangePeriodSummary alignment with server day bounds", () => {
	test("today period matches Shanghai calendar day boundaries", () => {
		const nowMs = Date.UTC(2026, 5, 15, 2, 0, 0)
		vi.useFakeTimers()
		vi.setSystemTime(nowMs)

		const summary = getRangePeriodSummary("today", "Asia/Shanghai")
		expect(summary).toEqual({ granularity: "day", period: "2026-06-15" })

		const bounds = getRangeBounds("today", "Asia/Shanghai")
		expect(bounds?.from).toBe(SHANGHAI_JUNE_15_START)
		expect(bounds?.to).toBe(nowMs)

		vi.useRealTimers()
	})

	test("today day start aligns with server getDayBounds golden end", () => {
		const nowMs = Date.UTC(2026, 5, 15, 2, 0, 0)
		vi.useFakeTimers()
		vi.setSystemTime(nowMs)

		const summary = getRangePeriodSummary("today", "Asia/Shanghai")
		const bounds = getRangeBounds("today", "Asia/Shanghai")
		expect(summary?.period).toBe("2026-06-15")
		expect(bounds?.from).toBe(SHANGHAI_JUNE_15_START)
		expect(bounds?.from).toBeLessThan(nowMs)
		expect(SHANGHAI_JUNE_15_END).toBe(
			SHANGHAI_JUNE_15_START + 24 * 60 * 60 * 1000,
		)

		vi.useRealTimers()
	})
})

describe("getRangeTrend", () => {
	test("thisWeek uses ISO week granularity aligned with period summary", () => {
		expect(getRangeTrend("thisWeek", "Asia/Shanghai")).toEqual({
			granularity: "week",
			periods: 1,
		})
	})

	test("thisWeek differs from last7days rolling day trend", () => {
		expect(getRangeTrend("last7days", "Asia/Shanghai")).toEqual({
			granularity: "day",
			periods: 7,
		})
		expect(getRangeTrend("thisWeek", "Asia/Shanghai")).not.toEqual(
			getRangeTrend("last7days", "Asia/Shanghai"),
		)
	})

	test("thisWeek trend period matches listTotals week period on Wednesday", () => {
		// 2026-06-17 10:00 UTC = Wednesday 18:00 in Shanghai
		const nowMs = Date.UTC(2026, 5, 17, 10, 0, 0)
		vi.useFakeTimers()
		vi.setSystemTime(nowMs)

		const trend = getRangeTrend("thisWeek", "Asia/Shanghai")
		const summary = getRangePeriodSummary("thisWeek", "Asia/Shanghai")
		const listTotals = getRangeListTotalsInput("thisWeek", "Asia/Shanghai")

		expect(trend).toEqual({ granularity: "week", periods: 1 })
		expect(summary).toEqual({ granularity: "week", period: "2026-W25" })
		expect(listTotals).toEqual({
			granularity: "week",
			period: "2026-W25",
		})

		vi.useRealTimers()
	})

	test("thisMonth uses elapsed days in current calendar month", () => {
		const nowMs = Date.UTC(2026, 5, 15, 12, 0, 0)
		vi.useFakeTimers()
		vi.setSystemTime(nowMs)

		expect(getRangeTrend("thisMonth", "Asia/Shanghai")).toEqual({
			granularity: "day",
			periods: 15,
		})

		vi.useRealTimers()
	})

	test("thisYear uses elapsed months in current calendar year", () => {
		const nowMs = Date.UTC(2026, 5, 15, 12, 0, 0)
		vi.useFakeTimers()
		vi.setSystemTime(nowMs)

		expect(getRangeTrend("thisYear", "Asia/Shanghai")).toEqual({
			granularity: "month",
			periods: 6,
		})

		vi.useRealTimers()
	})

	test("all uses year granularity", () => {
		expect(getRangeTrend("all", "Asia/Shanghai")).toEqual({
			granularity: "year",
			periods: 10,
		})
	})

	test("thisMonth trend period count matches range bounds day span", () => {
		const nowMs = Date.UTC(2026, 5, 15, 12, 0, 0)
		vi.useFakeTimers()
		vi.setSystemTime(nowMs)

		const trend = getRangeTrend("thisMonth", "Asia/Shanghai")
		const bounds = getRangeBounds("thisMonth", "Asia/Shanghai")
		expect(trend?.periods).toBe(15)
		expect(bounds?.from).toBe(SHANGHAI_JUNE_15_START - 14 * 24 * 60 * 60 * 1000)

		vi.useRealTimers()
	})
})

describe("getRangeBounds", () => {
	test("last7days spans six prior days through now in zone", () => {
		const nowMs = Date.UTC(2026, 5, 15, 10, 0, 0)
		vi.useFakeTimers()
		vi.setSystemTime(nowMs)

		const bounds = getRangeBounds("last7days", "Asia/Shanghai")
		expect(bounds?.to).toBe(nowMs)
		expect(bounds?.from).toBe(SHANGHAI_JUNE_15_START - 6 * 24 * 60 * 60 * 1000)

		vi.useRealTimers()
	})
})

describe("toUsageTotalsInput", () => {
	test("bounds input maps to an all-granularity query with from/to", () => {
		const input = toUsageTotalsInput(
			"resource",
			{ from: 100, to: 200 },
			{
				order: "time",
				limit: 10,
				timeZone: "UTC",
			},
		)
		expect(input).toEqual({
			entityType: "resource",
			granularity: "all",
			from: 100,
			to: 200,
			order: "time",
			limit: 10,
			timeZone: "UTC",
		})
	})

	test("period input keeps the period and granularity", () => {
		const input = toUsageTotalsInput(
			"character",
			{ granularity: "week", period: "2026-W25" },
			{ order: "views", limit: 5, timeZone: "UTC" },
		)
		expect(input).toEqual({
			entityType: "character",
			granularity: "week",
			period: "2026-W25",
			order: "views",
			limit: 5,
			timeZone: "UTC",
		})
	})

	test("all input stays all-time without bounds", () => {
		const input = toUsageTotalsInput(
			"plugin",
			{ granularity: "all" },
			{ order: "time", limit: 10, timeZone: "UTC" },
		)
		expect(input).toEqual({
			entityType: "plugin",
			granularity: "all",
			order: "time",
			limit: 10,
			timeZone: "UTC",
		})
	})
})
