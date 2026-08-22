import type { UsageRange } from "./date"

export type UsageInsight = {
	readonly deltaMs: number
	readonly comparisonKey: string
}

export function getUsageInsightComparison(
	range: UsageRange,
): { comparisonKey: string } | null {
	switch (range) {
		case "today":
			return { comparisonKey: "usage.insight.comparison.yesterday" }
		case "last7days":
			return { comparisonKey: "usage.insight.comparison.prior7Days" }
		case "thisWeek":
			return { comparisonKey: "usage.insight.comparison.lastWeek" }
		case "thisMonth":
			return { comparisonKey: "usage.insight.comparison.lastMonth" }
		case "thisYear":
			return { comparisonKey: "usage.insight.comparison.lastYear" }
		case "all":
			return null
	}
}

export function getUsageInsightTrendInput(
	range: UsageRange,
): { granularity: "day" | "week" | "month" | "year"; periods: number } | null {
	switch (range) {
		case "today":
			return { granularity: "day", periods: 2 }
		case "last7days":
			return { granularity: "day", periods: 14 }
		case "thisWeek":
			return { granularity: "week", periods: 2 }
		case "thisMonth":
			return { granularity: "month", periods: 2 }
		case "thisYear":
			return { granularity: "year", periods: 2 }
		case "all":
			return null
	}
}

function sumBucketRange(
	buckets: readonly { totalMs: number }[],
	from: number,
	to: number,
): number {
	let total = 0
	for (let i = from; i < to; i++) {
		total += buckets[i]?.totalMs ?? 0
	}
	return total
}

export function computeUsageInsight(
	buckets: readonly { totalMs: number }[],
	comparisonKey: string,
	range?: UsageRange,
): UsageInsight | null {
	if (range === "last7days") {
		if (buckets.length < 14) return null
		const current = sumBucketRange(buckets, 7, 14)
		const previous = sumBucketRange(buckets, 0, 7)
		return { deltaMs: current - previous, comparisonKey }
	}
	if (buckets.length < 2) return null
	const current = buckets[buckets.length - 1]?.totalMs ?? 0
	const previous = buckets[buckets.length - 2]?.totalMs ?? 0
	return {
		deltaMs: current - previous,
		comparisonKey,
	}
}
