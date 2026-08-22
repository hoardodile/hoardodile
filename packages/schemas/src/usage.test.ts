import { describe, expect, test } from "vitest"
import {
	requiredUsageTimeZone,
	resolvedUsageTimeZone,
	usageDailySummaryInput,
	usagePeriodSummaryInput,
	usageRecommendationsInput,
	usageTotalsInput,
	usageTrendInput,
} from "./usage.ts"

describe("requiredUsageTimeZone", () => {
	test("rejects local sentinel", () => {
		expect(requiredUsageTimeZone.safeParse("local").success).toBe(false)
		expect(requiredUsageTimeZone.safeParse("").success).toBe(false)
	})

	test("accepts IANA zones", () => {
		expect(requiredUsageTimeZone.safeParse("Asia/Shanghai").success).toBe(true)
		expect(requiredUsageTimeZone.safeParse("UTC").success).toBe(true)
	})

	test("rejects invalid IANA zone names", () => {
		expect(requiredUsageTimeZone.safeParse("Foo/Bar").success).toBe(false)
	})
})

describe("resolvedUsageTimeZone", () => {
	test("allows undefined", () => {
		expect(resolvedUsageTimeZone.safeParse(undefined).success).toBe(true)
	})

	test("rejects local sentinel when provided", () => {
		expect(resolvedUsageTimeZone.safeParse("local").success).toBe(false)
	})
})

describe("usageTrendInput timeZone", () => {
	test("accepts resolved zone on trend input", () => {
		const parsed = usageTrendInput.parse({
			granularity: "day",
			timeZone: "Asia/Shanghai",
		})
		expect(parsed.timeZone).toBe("Asia/Shanghai")
	})

	test("rejects local sentinel on trend input", () => {
		expect(
			usageTrendInput.safeParse({ granularity: "day", timeZone: "local" })
				.success,
		).toBe(false)
	})

	test("requires timeZone on trend input", () => {
		expect(usageTrendInput.safeParse({ granularity: "day" }).success).toBe(
			false,
		)
	})
})

describe("usageTotalsInput timeZone", () => {
	test("allows omitted timeZone when granularity is all", () => {
		expect(
			usageTotalsInput.safeParse({
				entityType: "resource",
				granularity: "all",
			}).success,
		).toBe(true)
	})

	test("requires timeZone when granularity is not all", () => {
		expect(
			usageTotalsInput.safeParse({
				entityType: "resource",
				granularity: "day",
				period: "2024-06-12",
			}).success,
		).toBe(false)
	})

	test("period branch requires timeZone in parsed output", () => {
		const parsed = usageTotalsInput.parse({
			entityType: "resource",
			granularity: "day",
			period: "2024-06-12",
			timeZone: "Asia/Shanghai",
		})
		if (parsed.granularity !== "all") {
			expect(parsed.timeZone).toBe("Asia/Shanghai")
			expect(parsed.period).toBe("2024-06-12")
		}
	})
})

describe("usageDailySummaryInput timeZone", () => {
	test("requires timeZone", () => {
		expect(
			usageDailySummaryInput.safeParse({ date: "2024-06-12" }).success,
		).toBe(false)
	})
})

describe("usagePeriodSummaryInput timeZone", () => {
	test("requires timeZone", () => {
		expect(
			usagePeriodSummaryInput.safeParse({
				granularity: "month",
				period: "2024-06",
			}).success,
		).toBe(false)
	})
})

describe("usageRecommendationsInput timeZone", () => {
	test("requires resolved timeZone", () => {
		expect(
			usageRecommendationsInput.safeParse({ kind: "continue" }).success,
		).toBe(false)
		expect(
			usageRecommendationsInput.safeParse({
				kind: "continue",
				timeZone: "Asia/Shanghai",
			}).success,
		).toBe(true)
	})

	test("rejects local sentinel", () => {
		expect(
			usageRecommendationsInput.safeParse({
				kind: "continue",
				timeZone: "local",
			}).success,
		).toBe(false)
	})
})
