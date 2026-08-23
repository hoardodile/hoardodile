/**
 * @vitest-environment node
 */

import { describe, expect, test, vi } from "vitest"
import { syncBrowserTimeZone } from "@/lib/timezone"
import {
	usageDailySummaryQueryOptions,
	usageRecommendationsQueryOptions,
	usageTimelineForRangeQueryOptions,
	usageTotalsQueryOptions,
	usageTrendQueryOptions,
} from "./api"

function mockBrowserTimeZone(timeZone: string) {
	vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
		timeZone,
	} as Intl.ResolvedDateTimeFormatOptions)
	syncBrowserTimeZone()
}

describe("usage API time zone resolution", () => {
	test("resolves local sentinel before listTotals query", () => {
		mockBrowserTimeZone("Asia/Shanghai")

		const options = usageTotalsQueryOptions({
			entityType: "resource",
			granularity: "day",
			period: "2024-06-12",
			order: "time",
			limit: 10,
			timeZone: "local",
		})
		const keyInput = (options.queryKey as readonly unknown[])[2] as {
			readonly timeZone?: string
		}
		expect(keyInput.timeZone).toBe("Asia/Shanghai")

		vi.restoreAllMocks()
	})

	test("resolves omitted timeZone to browser IANA on trend query", () => {
		mockBrowserTimeZone("Europe/Paris")

		const options = usageTrendQueryOptions({
			granularity: "day",
			periods: 7,
		})
		const keyInput = (options.queryKey as readonly unknown[])[2] as {
			readonly timeZone?: string
		}
		expect(keyInput.timeZone).toBe("Europe/Paris")

		vi.restoreAllMocks()
	})

	test("resolves omitted timeZone on dailySummary query", () => {
		mockBrowserTimeZone("UTC")

		const options = usageDailySummaryQueryOptions({
			date: "2024-06-12",
			limit: 10,
		})
		const keyInput = (options.queryKey as readonly unknown[])[2] as {
			readonly timeZone?: string
		}
		expect(keyInput.timeZone).toBe("UTC")

		vi.restoreAllMocks()
	})

	test("resolves timeZone on recommendations query", () => {
		mockBrowserTimeZone("Asia/Tokyo")

		const options = usageRecommendationsQueryOptions("continue", "local")
		const keyTimeZone = (options.queryKey as readonly unknown[])[3]
		expect(keyTimeZone).toBe("Asia/Tokyo")

		vi.restoreAllMocks()
	})

	test("usageTimelineForRangeQueryOptions derives bounds from time zone pref", () => {
		const nowMs = Date.UTC(2026, 5, 15, 2, 0, 0)
		vi.useFakeTimers()
		vi.setSystemTime(nowMs)

		const options = usageTimelineForRangeQueryOptions({
			range: "today",
			timeZone: "Asia/Shanghai",
			limit: 10,
		})
		const keyInput = (options.queryKey as readonly unknown[])[2] as {
			readonly from?: number
			readonly to?: number
		}
		expect(keyInput.from).toBe(Date.UTC(2026, 5, 14, 16, 0, 0))
		expect(keyInput.to).toBe(nowMs)

		vi.useRealTimers()
	})
})
