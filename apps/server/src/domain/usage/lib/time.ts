import type { UsageReportGranularity } from "@hoardodile/schemas"
import {
	dayjsForInstant,
	formatUsagePeriod,
	getUsageDayBounds,
	parseInZone,
	requireIanaTimeZone,
} from "@hoardodile/shared/usage-period"
import type dayjs from "src/lib/dayjs.ts"

export type PeriodBounds = {
	readonly start: number
	readonly end: number
	readonly period: string
}

export { requireIanaTimeZone }

export function dayjsFor(ts: number, timeZone: string): dayjs.Dayjs {
	return dayjsForInstant(ts, timeZone)
}

/**
 * Parse a period string for the given granularity and time zone.
 *
 * - `day`: `YYYY-MM-DD`
 * - `week`: `YYYY-Www`
 * - `month`: `YYYY-MM`
 * - `year`: `YYYY`
 */
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
/** Cadence of the coarse offset sampling in {@link buildHourOfDayIndex}. */
const OFFSET_SAMPLE_INTERVAL_MS = 7 * DAY_MS

/**
 * Precomputed UTC-offset transitions for a time zone over a window.
 *
 * Wall-clock math for arbitrary instants is done with pure integer
 * arithmetic against this table instead of per-instant dayjs timezone
 * calls (~60µs each), which dominate the per-hour window walk. The table
 * is built from a handful of dayjs samples plus bisection at each DST
 * transition (a few ms for a year-long window) and then answers
 * hour-of-day / local-hour-floor lookups in microseconds.
 */
export type HourOfDayIndex = {
	/** Sorted by `instant`; `offsetMs` applies from each instant onward. */
	readonly transitions: readonly {
		readonly instant: number
		readonly offsetMs: number
	}[]
	/** Wall-clock hour (0–23) of an instant in the zone. */
	hourOfDay(ts: number): number
	/** Epoch ms of the local hour boundary at or before an instant. */
	hourStart(ts: number): number
}

/**
 * Build the offset-transition table covering `[from, to]` (plus margin so
 * hour floors just outside the window stay resolvable). Zones change their
 * UTC offset only at a handful of instants per year, so coarse sampling
 * plus bisection finds every transition exactly.
 */
export function buildHourOfDayIndex(
	from: number,
	to: number,
	timeZone: string,
): HourOfDayIndex {
	const start = from - DAY_MS
	const end = to + DAY_MS

	function offsetAt(ts: number): number {
		return dayjsFor(ts, timeZone).utcOffset() * 60_000
	}

	const transitions: { instant: number; offsetMs: number }[] = []
	transitions.push({ instant: start, offsetMs: offsetAt(start) })
	let cursor = start + OFFSET_SAMPLE_INTERVAL_MS
	for (; cursor <= end; cursor += OFFSET_SAMPLE_INTERVAL_MS) {
		const offsetMs = offsetAt(cursor)
		const previous = transitions[transitions.length - 1]!
		if (offsetMs === previous.offsetMs) continue
		// The offset changed somewhere in (previous.instant, cursor] —
		// bisect down to a millisecond. DST transitions land on whole
		// instants, so the bisection pins the exact transition instant.
		let lo = previous.instant
		let hi = cursor
		while (hi - lo > 1) {
			const mid = Math.floor((lo + hi) / 2)
			if (offsetAt(mid) === previous.offsetMs) {
				lo = mid
			} else {
				hi = mid
			}
		}
		transitions.push({ instant: hi, offsetMs })
	}
	// The coarse cadence can leave the final stretch unsampled — pin the
	// window end so a transition inside a short window (e.g. a few days
	// around a fall-back day) is never missed. No-op when the end offset
	// already matches the last transition.
	const endOffset = offsetAt(end)
	const previous = transitions[transitions.length - 1]!
	if (endOffset !== previous.offsetMs) {
		let lo = previous.instant
		let hi = end
		while (hi - lo > 1) {
			const mid = Math.floor((lo + hi) / 2)
			if (offsetAt(mid) === previous.offsetMs) {
				lo = mid
			} else {
				hi = mid
			}
		}
		transitions.push({ instant: hi, offsetMs: endOffset })
	}

	function offsetFor(ts: number): number {
		let lo = 0
		let hi = transitions.length - 1
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1
			if (transitions[mid]!.instant <= ts) {
				lo = mid
			} else {
				hi = mid - 1
			}
		}
		return transitions[lo]!.offsetMs
	}

	return {
		transitions,
		hourOfDay: (ts) => Math.floor((ts + offsetFor(ts)) / HOUR_MS) % 24,
		hourStart: (ts) => {
			let offsetMs = offsetFor(ts)
			let start = Math.floor((ts + offsetMs) / HOUR_MS) * HOUR_MS - offsetMs
			// A transition between the hour boundary and `ts` shifts the
			// boundary itself — recompute with the boundary's own offset.
			const startOffset = offsetFor(start)
			if (startOffset !== offsetMs) {
				offsetMs = startOffset
				start = Math.floor((ts + offsetMs) / HOUR_MS) * HOUR_MS - offsetMs
			}
			return start
		},
	}
}

/**
 * Split a session into hour-of-day buckets (24 slots, local time) within
 * the given window. Segments are real-hour slices bucketed by their
 * start's wall-clock hour, so a session spanning midnight accumulates into
 * both affected hours (and DST repeats double an hour's capacity — fine
 * for a daily-rhythm average). Pass a prebuilt {@link HourOfDayIndex}
 * when splitting many sessions of one window; otherwise the index is
 * built per call.
 */
export function splitSessionIntoHourOfDayMs(
	startedAt: number,
	endedAt: number,
	from: number,
	to: number,
	timeZone: string,
	index?: HourOfDayIndex,
): readonly number[] {
	const hourly = Array.from({ length: 24 }, () => 0)
	const overlapStart = Math.max(startedAt, from)
	const overlapEnd = Math.min(endedAt, to)
	if (overlapEnd <= overlapStart) return hourly

	const hourIndex = index ?? buildHourOfDayIndex(from, to, timeZone)
	let cursor = hourIndex.hourStart(overlapStart)
	while (cursor < overlapEnd) {
		const next = cursor + HOUR_MS
		const segmentStart = Math.max(cursor, overlapStart)
		const segmentEnd = Math.min(next, overlapEnd)
		if (segmentEnd > segmentStart) {
			// Credit the segment to the wall hour of its midpoint — an
			// interior point, so segments that touch a DST transition
			// instant are attributed unambiguously.
			const hour = hourIndex.hourOfDay(
				Math.floor((segmentStart + segmentEnd) / 2),
			)
			hourly[hour] = (hourly[hour] ?? 0) + (segmentEnd - segmentStart)
		}
		cursor = next
	}
	return hourly
}

function parsePeriod(
	granularity: UsageReportGranularity,
	period: string,
	timeZone: string,
): dayjs.Dayjs {
	switch (granularity) {
		case "day":
			return parseInZone(period, timeZone).startOf("day")
		case "week": {
			const match = /^(\d{4})-W(\d{2})$/.exec(period)
			if (match === null) {
				throw new Error(`Invalid week period: ${period}`)
			}
			const [, year, week] = match
			// Jan 4 is always in ISO week 1; anchor before applying week/year.
			return parseInZone(`${year}-01-04`, timeZone)
				.isoWeek(Number(week))
				.isoWeekday(1)
				.startOf("day")
		}
		case "month":
			return parseInZone(period, timeZone).startOf("month")
		case "year":
			return parseInZone(period, timeZone).startOf("year")
	}
}

function nextPeriodStart(
	start: dayjs.Dayjs,
	granularity: UsageReportGranularity,
): dayjs.Dayjs {
	const next = start.add(1, granularity as dayjs.ManipulateType)
	switch (granularity) {
		case "day":
		case "week":
			return next.startOf("day")
		case "month":
			return next.startOf("month")
		case "year":
			return next.startOf("year")
	}
}

export function getPeriodBounds(
	granularity: UsageReportGranularity,
	period: string,
	timeZone: string,
): PeriodBounds {
	const start = parsePeriod(granularity, period, timeZone)
	const end = nextPeriodStart(start, granularity)
	return {
		start: start.valueOf(),
		end: end.valueOf(),
		period,
	}
}

export function formatPeriod(
	ts: number,
	granularity: UsageReportGranularity,
	timeZone: string,
): string {
	return formatUsagePeriod(ts, granularity, timeZone)
}

export function getTrendPeriods(
	granularity: UsageReportGranularity,
	periods: number,
	nowMs: number,
	timeZone: string,
): readonly PeriodBounds[] {
	const now = dayjsFor(nowMs, timeZone)
	const current =
		granularity === "week"
			? now.isoWeekday(1).startOf("day")
			: now.startOf(granularity)

	const result: PeriodBounds[] = []
	for (let i = periods - 1; i >= 0; i--) {
		const start = current.subtract(i, granularity as dayjs.ManipulateType)
		const end = nextPeriodStart(start, granularity)
		result.push({
			start: start.valueOf(),
			end: end.valueOf(),
			period: formatPeriod(start.valueOf(), granularity, timeZone),
		})
	}
	return result
}

export function getDayBounds(
	day: string,
	timeZone: string,
): { readonly start: number; readonly end: number } {
	return getUsageDayBounds(day, timeZone)
}

/** Inclusive start of a rolling calendar-day window ending at `nowMs`. */
export function getCalendarWindowStart(
	nowMs: number,
	windowDays: number,
	timeZone: string,
): number {
	requireIanaTimeZone(timeZone)
	const firstDay = dayjsFor(nowMs, timeZone)
		.subtract(windowDays - 1, "day")
		.format("YYYY-MM-DD")
	return getDayBounds(firstDay, timeZone).start
}

/** Whole calendar days from `earlierMs` to `laterMs` in `timeZone`. */
export function calendarDaysSince(
	earlierMs: number,
	laterMs: number,
	timeZone: string,
): number {
	requireIanaTimeZone(timeZone)
	const laterDay = dayjsFor(laterMs, timeZone).startOf("day")
	const earlierDay = dayjsFor(earlierMs, timeZone).startOf("day")
	return laterDay.diff(earlierDay, "day")
}

type DayHourBucket = {
	readonly hourStart: number
	readonly label: string
}

function buildDayHourBuckets(
	day: string,
	timeZone: string,
): readonly DayHourBucket[] {
	const buckets: DayHourBucket[] = []
	for (let hour = 0; hour < 24; hour++) {
		const label = `${String(hour).padStart(2, "0")}:00`
		const parsed = parseInZone(`${day} ${label}`, timeZone)
		if (
			parsed.format("YYYY-MM-DD") !== day ||
			parsed.format("HH:mm") !== label
		) {
			continue
		}
		buckets.push({ hourStart: parsed.valueOf(), label })
	}

	const expanded: DayHourBucket[] = []
	for (let i = 0; i < buckets.length; i++) {
		const bucket = buckets[i]!
		expanded.push(bucket)
		const next = buckets[i + 1]
		if (next === undefined) break
		let cursor = bucket.hourStart + 60 * 60 * 1000
		while (
			next.hourStart - bucket.hourStart > 60 * 60 * 1000 &&
			cursor < next.hourStart
		) {
			expanded.push({
				hourStart: cursor,
				label: dayjsFor(cursor, timeZone).format("HH:mm"),
			})
			cursor += 60 * 60 * 1000
		}
	}
	return expanded
}

/** Local hour starts and display labels for a calendar day in the given zone. */
export function getDayHourBuckets(
	dayStart: number,
	_dayEnd: number,
	timeZone: string,
): {
	readonly hourStarts: readonly number[]
	readonly labels: readonly string[]
} {
	const day = dayjsFor(dayStart, timeZone).format("YYYY-MM-DD")
	const buckets = buildDayHourBuckets(day, timeZone)
	return {
		hourStarts: buckets.map((bucket) => bucket.hourStart),
		labels: buckets.map((bucket) => bucket.label),
	}
}

/**
 * Split a session into hourly buckets in the given time zone.
 *
 * Returns one bucket per local hour in the calendar day (23, 24, or 25 on DST
 * transition days). Sessions that span local midnight are truncated to the
 * provided day bounds. Pass precomputed `hourStarts` (from
 * {@link getDayHourBuckets}) when splitting many sessions of one day so the
 * bucket boundaries are built once instead of per session.
 */
export function splitSessionIntoHourlyMs(
	startedAt: number,
	endedAt: number,
	dayStart: number,
	dayEnd: number,
	timeZone: string,
	hourStarts?: readonly number[],
): readonly number[] {
	const starts =
		hourStarts ?? getDayHourBuckets(dayStart, dayEnd, timeZone).hourStarts
	const hourlyMs = Array.from({ length: starts.length }, () => 0)

	const overlapStart = Math.max(startedAt, dayStart)
	const overlapEnd = Math.min(endedAt, dayEnd)
	if (overlapEnd <= overlapStart) return hourlyMs

	for (let i = 0; i < starts.length; i++) {
		const hourStart = starts[i]!
		const hourEnd = i + 1 < starts.length ? starts[i + 1]! : dayEnd
		const segmentStart = Math.max(hourStart, overlapStart)
		const segmentEnd = Math.min(hourEnd, overlapEnd)
		if (segmentEnd > segmentStart) {
			hourlyMs[i] = segmentEnd - segmentStart
		}
	}

	return hourlyMs
}

/**
 * Filter sessions to those that overlap the given time range and belong to the
 * requested entity/client filters.
 */
export function overlapMs(
	aStart: number,
	aEnd: number,
	bStart: number,
	bEnd: number,
): number {
	const start = Math.max(aStart, bStart)
	const end = Math.min(aEnd, bEnd)
	return end > start ? end - start : 0
}
