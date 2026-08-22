/**
 * @vitest-environment node
 */

import type { UsageTotal } from "@hoardodile/schemas"
import { describe, expect, it } from "vitest"
import {
	computePeriodTotalMs,
	computePeriodTotalViews,
	mergeShareTotals,
	SHARE_LIST_PAGE_SIZE,
	SHARE_SEGMENTS_LIMIT,
	shareListLimit,
	shareListOrder,
} from "./statsShare"

const rows: UsageTotal[] = [
	{
		id: "a",
		entityType: "resource",
		entityId: "r1",
		granularity: "all",
		period: null,
		totalMs: 100,
		viewCount: 2,
		lastViewedAt: 1,
		updatedAt: 1,
	},
	{
		id: "b",
		entityType: "resource",
		entityId: "r2",
		granularity: "all",
		period: null,
		totalMs: 50,
		viewCount: 5,
		lastViewedAt: 2,
		updatedAt: 2,
	},
]

describe("statsShare", () => {
	it("mergeShareTotals sorts by time or views", () => {
		expect(mergeShareTotals(rows, 10, "time")[0]?.entityId).toBe("r1")
		expect(mergeShareTotals(rows, 10, "views")[0]?.entityId).toBe("r2")
	})

	it("shareListOrder maps metric to API order", () => {
		expect(shareListOrder("time")).toBe("time")
		expect(shareListOrder("views")).toBe("views")
	})

	it("shareListLimit reuses the share-bar window for pages that fit within it", () => {
		expect(shareListLimit(1)).toBe(SHARE_SEGMENTS_LIMIT)
		expect(shareListLimit(SHARE_LIST_PAGE_SIZE - 1)).toBe(SHARE_SEGMENTS_LIMIT)
		// The last page that fully fits: page × 10 == 100.
		expect(shareListLimit(SHARE_LIST_PAGE_SIZE)).toBe(SHARE_SEGMENTS_LIMIT)
	})

	it("shareListLimit requests exactly the rendered window past the share fetch", () => {
		const deepPage = SHARE_LIST_PAGE_SIZE + 1
		expect(shareListLimit(deepPage)).toBe(deepPage * SHARE_LIST_PAGE_SIZE)
		expect(shareListLimit(deepPage + 5)).toBe(
			(deepPage + 5) * SHARE_LIST_PAGE_SIZE,
		)
	})

	it("computePeriodTotalViews uses dashboard totalViews for all range", () => {
		expect(
			computePeriodTotalViews({
				range: "all",
				dailySummary: undefined,
				dashboard: { totalViews: 12 },
				trend: undefined,
			}),
		).toBe(12)
	})

	it("computePeriodTotalMs uses dashboard totalMs for all range", () => {
		expect(
			computePeriodTotalMs({
				range: "all",
				dailySummary: undefined,
				dashboard: { totalMs: 99_000 },
				trend: undefined,
			}),
		).toBe(99_000)
	})

	it("computePeriodTotalMs uses the daily summary for today", () => {
		expect(
			computePeriodTotalMs({
				range: "today",
				dailySummary: { totalMs: 123_000 },
				dashboard: undefined,
				trend: undefined,
			}),
		).toBe(123_000)
	})

	it("computePeriodTotalMs sums the trend buckets for multi-day ranges", () => {
		const trend = {
			granularity: "day" as const,
			buckets: [
				{ period: "a", totalMs: 10_000, sessionCount: 1 },
				{ period: "b", totalMs: 20_000, sessionCount: 2 },
				{ period: "c", totalMs: 30_000, sessionCount: 3 },
			],
		}
		expect(
			computePeriodTotalMs({
				range: "last7days",
				dailySummary: undefined,
				dashboard: undefined,
				trend,
			}),
		).toBe(60_000)
	})

	it("computePeriodTotalMs falls back to the dashboard when the trend is missing", () => {
		expect(
			computePeriodTotalMs({
				range: "last7days",
				dailySummary: undefined,
				dashboard: { totalMs: 5_000 },
				trend: undefined,
			}),
		).toBe(5_000)
	})

	it("computePeriodTotalViews sums the trend sessions for multi-day ranges", () => {
		const trend = {
			granularity: "day" as const,
			buckets: [
				{ period: "a", totalMs: 0, sessionCount: 2 },
				{ period: "b", totalMs: 0, sessionCount: 3 },
			],
		}
		expect(
			computePeriodTotalViews({
				range: "thisWeek",
				dailySummary: undefined,
				dashboard: undefined,
				trend,
			}),
		).toBe(5)
	})

	it("computePeriodTotalViews uses the daily summary for today", () => {
		expect(
			computePeriodTotalViews({
				range: "today",
				dailySummary: { sessionCount: 7 },
				dashboard: undefined,
				trend: undefined,
			}),
		).toBe(7)
	})

	it("computePeriodTotalViews falls back to the dashboard when nothing else matches", () => {
		expect(
			computePeriodTotalViews({
				range: "thisMonth",
				dailySummary: undefined,
				dashboard: { totalViews: 4 },
				trend: undefined,
			}),
		).toBe(4)
	})
})
