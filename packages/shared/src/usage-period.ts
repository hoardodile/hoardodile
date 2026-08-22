import {
	isValidIanaTimeZone,
	LOCAL_TIME_ZONE_SENTINEL,
} from "@hoardodile/schemas/timezone"
import type { UsageReportGranularity } from "@hoardodile/schemas/usage"
import dayjs from "./dayjs.ts"

function assertIanaTimeZone(timeZone: string): void {
	if (timeZone === LOCAL_TIME_ZONE_SENTINEL || timeZone.length === 0) {
		throw new Error(
			"timeZone must be a resolved IANA zone; resolve client-side before calling usage period helpers",
		)
	}
	if (!isValidIanaTimeZone(timeZone)) {
		throw new Error("timeZone must be a valid IANA zone")
	}
}

/** Require a resolved IANA zone for period-bound usage queries. */
export function requireIanaTimeZone(timeZone: string | undefined): string {
	if (timeZone === undefined) {
		throw new Error("timeZone is required for period-bound usage queries")
	}
	assertIanaTimeZone(timeZone)
	return timeZone
}

/** Format an instant as dayjs in a resolved IANA zone. */
export function dayjsForInstant(ts: number, timeZone: string): dayjs.Dayjs {
	assertIanaTimeZone(timeZone)
	return dayjs(ts).tz(timeZone)
}

/** Parse a calendar date/time string in a resolved IANA zone. */
export function parseInZone(input: string, timeZone: string): dayjs.Dayjs {
	assertIanaTimeZone(timeZone)
	return dayjs.tz(input, timeZone)
}

function dayjsFor(ts: number, timeZone: string): dayjs.Dayjs {
	return dayjsForInstant(ts, timeZone)
}

/** Format an instant as a usage period string in the given IANA zone. */
export function formatUsagePeriod(
	ts: number,
	granularity: UsageReportGranularity,
	timeZone: string,
): string {
	const d = dayjsFor(ts, timeZone)
	switch (granularity) {
		case "day":
			return d.format("YYYY-MM-DD")
		case "week":
			return `${d.isoWeekYear()}-W${String(d.isoWeek()).padStart(2, "0")}`
		case "month":
			return d.format("YYYY-MM")
		case "year":
			return d.format("YYYY")
	}
}

/** Calendar day bounds as Unix milliseconds in the given IANA zone. */
export function getUsageDayBounds(
	day: string,
	timeZone: string,
): { readonly start: number; readonly end: number } {
	const dayAnchor = parseInZone(day, timeZone)
	const start = dayAnchor.startOf("day")
	const end = dayAnchor.add(1, "day").startOf("day")
	return {
		start: start.valueOf(),
		end: end.valueOf(),
	}
}

/** Elapsed calendar days in the current month (1-based day of month). */
export function elapsedDaysInMonth(nowMs: number, timeZone: string): number {
	return dayjsFor(nowMs, timeZone).date()
}

/** Elapsed calendar months in the current year (1–12). */
export function elapsedMonthsInYear(nowMs: number, timeZone: string): number {
	return dayjsFor(nowMs, timeZone).month() + 1
}
