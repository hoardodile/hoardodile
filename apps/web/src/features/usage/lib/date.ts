import type {
	UsageEntityType,
	UsageGranularity,
	UsageReportGranularity,
	UsageTotalsInput,
} from "@hoardodile/schemas"
import {
	elapsedDaysInMonth,
	elapsedMonthsInYear,
	formatUsagePeriod,
} from "@hoardodile/shared/usage-period"
import dayjs from "@/lib/dayjs"
import { dayjsFor, resolveBrowserTimeZone } from "@/lib/timezone"

export { dayjsFor } from "@/lib/timezone"

export type UsageRange =
	| "today"
	| "last7days"
	| "thisWeek"
	| "thisMonth"
	| "thisYear"
	| "all"

/** Format a `YYYY-MM-DD` usage period as `MM-DD` in the given time-zone pref. */
export function formatDayPeriodLabel(
	period: string,
	timeZonePref: string,
): string {
	const zone = resolveBrowserTimeZone(timeZonePref)
	return dayjs.tz(period, zone).format("MM-DD")
}

export function formatDay(ts: number, timeZone: string): string {
	return formatUsagePeriod(ts, "day", resolveBrowserTimeZone(timeZone))
}

export function formatWeek(ts: number, timeZone: string): string {
	return formatUsagePeriod(ts, "week", resolveBrowserTimeZone(timeZone))
}

export function formatMonth(ts: number, timeZone: string): string {
	return formatUsagePeriod(ts, "month", resolveBrowserTimeZone(timeZone))
}

export function formatYear(ts: number, timeZone: string): string {
	return formatUsagePeriod(ts, "year", resolveBrowserTimeZone(timeZone))
}

export function getRangeTrend(
	range: UsageRange,
	timeZone: string,
): {
	granularity: UsageReportGranularity
	periods: number
} | null {
	switch (range) {
		case "today":
			return null
		case "last7days":
			return { granularity: "day", periods: 7 }
		case "thisWeek":
			return { granularity: "week", periods: 1 }
		case "thisMonth": {
			const zone = resolveBrowserTimeZone(timeZone)
			return {
				granularity: "day",
				periods: elapsedDaysInMonth(Date.now(), zone),
			}
		}
		case "thisYear": {
			const zone = resolveBrowserTimeZone(timeZone)
			return {
				granularity: "month",
				periods: elapsedMonthsInYear(Date.now(), zone),
			}
		}
		case "all":
			return { granularity: "year", periods: 10 }
	}
}

export function getRangePeriodSummary(
	range: UsageRange,
	timeZone: string,
): { granularity: UsageReportGranularity; period: string } | null {
	switch (range) {
		case "today":
			return { granularity: "day", period: formatDay(Date.now(), timeZone) }
		case "last7days":
			return null
		case "thisWeek":
			return { granularity: "week", period: formatWeek(Date.now(), timeZone) }
		case "thisMonth":
			return { granularity: "month", period: formatMonth(Date.now(), timeZone) }
		case "thisYear":
			return { granularity: "year", period: formatYear(Date.now(), timeZone) }
		case "all":
			return null
	}
}

/** Ranges that support a single period-bound `listTotals` query. */
export function rangeSupportsListTotals(range: UsageRange): boolean {
	return range !== "last7days"
}

/** Period input for a single `listTotals` query derived from a stats range. */
export type UsageListTotalsInput =
	| { readonly granularity: "all" }
	| {
			readonly granularity: Exclude<UsageGranularity, "all">
			readonly period: string
	  }
	| { readonly from: number; readonly to: number }

export function getRangeListTotalsInput(
	range: UsageRange,
	timeZone: string,
): UsageListTotalsInput {
	if (!rangeSupportsListTotals(range)) {
		// Multi-day windows (last 7 days) cannot be one period — pass the
		// calendar bounds so the totals clip sessions like the trend does.
		const bounds = getRangeBounds(range, timeZone)
		if (bounds !== undefined) {
			return { from: bounds.from, to: bounds.to }
		}
	}
	const summary = getRangePeriodSummary(range, timeZone)
	if (summary === null) {
		return { granularity: "all" }
	}
	return {
		granularity: summary.granularity as Exclude<UsageGranularity, "all">,
		period: summary.period,
	}
}

export function toUsageTotalsInput(
	entityType: UsageEntityType,
	listTotals: UsageListTotalsInput,
	common: {
		readonly order: UsageTotalsInput["order"]
		readonly limit: number
		readonly page?: number
		readonly timeZone: string
		readonly platform?: UsageTotalsInput["platform"]
		readonly exposureMode?: UsageTotalsInput["exposureMode"]
	},
): UsageTotalsInput {
	if ("from" in listTotals) {
		return {
			entityType,
			granularity: "all",
			from: listTotals.from,
			to: listTotals.to,
			order: common.order,
			limit: common.limit,
			page: common.page,
			timeZone: common.timeZone,
			platform: common.platform,
			exposureMode: common.exposureMode,
		}
	}
	if (listTotals.granularity === "all") {
		return {
			entityType,
			granularity: "all",
			order: common.order,
			limit: common.limit,
			page: common.page,
			timeZone: common.timeZone,
			platform: common.platform,
			exposureMode: common.exposureMode,
		}
	}
	return {
		entityType,
		granularity: listTotals.granularity,
		period: listTotals.period,
		order: common.order,
		limit: common.limit,
		page: common.page,
		timeZone: common.timeZone,
		platform: common.platform,
		exposureMode: common.exposureMode,
	}
}

/** Inclusive start and exclusive-style end timestamps for timeline filtering.
 *  Callers must compute bounds in the user's time zone; `usage.timeline` accepts
 *  raw epoch ms only (no server-side zone). Prefer `usageTimelineForRangeQueryOptions`. */
export function getRangeBounds(
	range: UsageRange,
	timeZone: string,
): { from: number; to: number } | undefined {
	const now = Date.now()
	const d = dayjsFor(now, timeZone)

	switch (range) {
		case "today":
			return { from: d.startOf("day").valueOf(), to: now }
		case "last7days":
			return {
				from: d.subtract(6, "day").startOf("day").valueOf(),
				to: now,
			}
		case "thisWeek":
			return { from: d.isoWeekday(1).startOf("day").valueOf(), to: now }
		case "thisMonth":
			return { from: d.startOf("month").valueOf(), to: now }
		case "thisYear":
			return { from: d.startOf("year").valueOf(), to: now }
		case "all":
			return undefined
	}
}
