/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import {
	computeUsageInsight,
	getUsageInsightComparison,
	getUsageInsightTrendInput,
} from "./usageInsight"

describe("usageInsight", () => {
	it("selects comparison period by range", () => {
		expect(getUsageInsightComparison("today")).toEqual({
			comparisonKey: "usage.insight.comparison.yesterday",
		})
		expect(getUsageInsightComparison("thisMonth")).toEqual({
			comparisonKey: "usage.insight.comparison.lastMonth",
		})
		expect(getUsageInsightComparison("all")).toBeNull()
	})

	it("computes rolling seven-day delta for last7days", () => {
		const buckets = Array.from({ length: 14 }, (_, index) => ({
			totalMs: index < 7 ? 10 : 20,
		}))
		const insight = computeUsageInsight(
			buckets,
			"usage.insight.comparison.prior7Days",
			"last7days",
		)
		expect(insight).toEqual({
			deltaMs: 70,
			comparisonKey: "usage.insight.comparison.prior7Days",
		})
	})

	it("computes delta between last two buckets", () => {
		const insight = computeUsageInsight(
			[{ totalMs: 100 }, { totalMs: 250 }],
			"usage.insight.comparison.lastWeek",
		)
		expect(insight).toEqual({
			deltaMs: 150,
			comparisonKey: "usage.insight.comparison.lastWeek",
		})
	})

	it("returns trend input for weekly ranges", () => {
		expect(getUsageInsightTrendInput("thisWeek")).toEqual({
			granularity: "week",
			periods: 2,
		})
		expect(getUsageInsightTrendInput("last7days")).toEqual({
			granularity: "day",
			periods: 14,
		})
	})
})
