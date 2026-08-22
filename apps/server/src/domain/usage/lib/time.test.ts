import dayjs from "@hoardodile/shared/dayjs"
import { describe, expect, test } from "vitest"
import {
	buildHourOfDayIndex,
	calendarDaysSince,
	formatPeriod,
	getCalendarWindowStart,
	getDayBounds,
	getDayHourBuckets,
	getPeriodBounds,
	getTrendPeriods,
	requireIanaTimeZone,
	splitSessionIntoHourlyMs,
	splitSessionIntoHourOfDayMs,
} from "./time.ts"

describe("assertIanaTimeZone", () => {
	test("rejects local sentinel", () => {
		expect(() => getDayBounds("2026-06-15", "local")).toThrow(
			/timeZone must be a resolved IANA zone/,
		)
	})

	test("rejects empty string", () => {
		expect(() => getDayBounds("2026-06-15", "")).toThrow(
			/timeZone must be a resolved IANA zone/,
		)
	})
})

describe("requireIanaTimeZone", () => {
	test("rejects undefined", () => {
		expect(() => requireIanaTimeZone(undefined)).toThrow(
			/timeZone is required for period-bound usage queries/,
		)
	})
})

describe("getDayBounds", () => {
	test("returns Shanghai calendar day boundaries in UTC milliseconds", () => {
		const { start, end } = getDayBounds("2026-06-15", "Asia/Shanghai")
		expect(start).toBe(Date.UTC(2026, 5, 14, 16, 0, 0))
		expect(end).toBe(Date.UTC(2026, 5, 15, 16, 0, 0))
	})

	test("returns UTC calendar day boundaries", () => {
		const { start, end } = getDayBounds("2026-06-15", "UTC")
		expect(start).toBe(Date.UTC(2026, 5, 15, 0, 0, 0))
		expect(end).toBe(Date.UTC(2026, 5, 16, 0, 0, 0))
	})

	test("spring-forward day is 23 hours in America/New_York", () => {
		const { start, end } = getDayBounds("2024-03-10", "America/New_York")
		expect(end - start).toBe(23 * 60 * 60 * 1000)
	})
})

describe("getPeriodBounds", () => {
	test("parses ISO week period in IANA zone", () => {
		const bounds = getPeriodBounds("week", "2026-W24", "Asia/Shanghai")
		expect(bounds.period).toBe("2026-W24")
		expect(bounds.end - bounds.start).toBe(7 * 24 * 60 * 60 * 1000)
	})

	test("parses month and year periods", () => {
		const month = getPeriodBounds("month", "2026-06", "UTC")
		expect(month.start).toBe(Date.UTC(2026, 5, 1, 0, 0, 0))
		expect(month.end).toBe(Date.UTC(2026, 6, 1, 0, 0, 0))

		const year = getPeriodBounds("year", "2026", "UTC")
		expect(year.start).toBe(Date.UTC(2026, 0, 1, 0, 0, 0))
		expect(year.end).toBe(Date.UTC(2027, 0, 1, 0, 0, 0))
	})

	test("spring-forward ISO week is 167 hours in America/New_York", () => {
		const bounds = getPeriodBounds("week", "2024-W10", "America/New_York")
		expect(bounds.period).toBe("2024-W10")
		expect(bounds.end - bounds.start).toBe(167 * 60 * 60 * 1000)
	})

	test("fall-back ISO week is 169 hours in America/New_York", () => {
		const bounds = getPeriodBounds("week", "2024-W44", "America/New_York")
		expect(bounds.period).toBe("2024-W44")
		expect(bounds.end - bounds.start).toBe(169 * 60 * 60 * 1000)
	})
})

describe("formatPeriod", () => {
	const ts = Date.UTC(2026, 5, 15, 4, 30, 0)

	test("formats day/week/month/year in zone", () => {
		expect(formatPeriod(ts, "day", "Asia/Shanghai")).toBe("2026-06-15")
		expect(formatPeriod(ts, "week", "Asia/Shanghai")).toMatch(/^2026-W\d{2}$/)
		expect(formatPeriod(ts, "month", "Asia/Shanghai")).toBe("2026-06")
		expect(formatPeriod(ts, "year", "Asia/Shanghai")).toBe("2026")
	})
})

describe("getTrendPeriods", () => {
	test("returns consecutive daily buckets ending at now", () => {
		const nowMs = Date.UTC(2026, 5, 15, 10, 0, 0)
		const buckets = getTrendPeriods("day", 3, nowMs, "UTC")
		expect(buckets).toHaveLength(3)
		expect(buckets[2]?.period).toBe("2026-06-15")
		expect(buckets[0]?.period).toBe("2026-06-13")
	})

	test("week bucket spanning spring-forward is 167 hours in America/New_York", () => {
		const nowMs = Date.UTC(2024, 2, 10, 18, 0, 0)
		const buckets = getTrendPeriods("week", 1, nowMs, "America/New_York")
		expect(buckets).toHaveLength(1)
		expect(buckets[0]?.period).toBe("2024-W10")
		expect(buckets[0]!.end - buckets[0]!.start).toBe(167 * 60 * 60 * 1000)
	})
})

describe("splitSessionIntoHourlyMs", () => {
	test("assigns cross-midnight overlap to Shanghai hour 0 only", () => {
		const shanghaiMidnight = Date.UTC(2026, 5, 14, 16, 0, 0)
		const dayStart = shanghaiMidnight
		const dayEnd = shanghaiMidnight + 24 * 60 * 60 * 1000
		const sessionStart = shanghaiMidnight - 30 * 60 * 1000
		const sessionEnd = shanghaiMidnight + 30 * 60 * 1000

		const hourlyMs = splitSessionIntoHourlyMs(
			sessionStart,
			sessionEnd,
			dayStart,
			dayEnd,
			"Asia/Shanghai",
		)

		expect(hourlyMs).toHaveLength(24)
		expect(hourlyMs[0]).toBe(30 * 60 * 1000)
		expect(hourlyMs[23]).toBe(0)
		expect(hourlyMs.reduce((sum, ms) => sum + ms, 0)).toBe(30 * 60 * 1000)
	})

	test("spring-forward day has 23 local hours in America/New_York", () => {
		const { start, end } = getDayBounds("2024-03-10", "America/New_York")
		const { hourStarts, labels } = getDayHourBuckets(
			start,
			end,
			"America/New_York",
		)

		expect(hourStarts).toHaveLength(23)
		expect(labels).toHaveLength(23)
		expect(labels).not.toContain("02:00")

		const sessionStart = hourStarts[1]!
		const sessionEnd = hourStarts[2]!
		const hourlyMs = splitSessionIntoHourlyMs(
			sessionStart,
			sessionEnd,
			start,
			end,
			"America/New_York",
		)
		expect(hourlyMs[1]).toBe(sessionEnd - sessionStart)
		expect(hourlyMs.reduce((sum, ms) => sum + ms, 0)).toBe(
			sessionEnd - sessionStart,
		)
	})

	test("fall-back day has 25 local hours in America/New_York", () => {
		const { start, end } = getDayBounds("2024-11-03", "America/New_York")
		const { hourStarts, labels } = getDayHourBuckets(
			start,
			end,
			"America/New_York",
		)

		expect(hourStarts).toHaveLength(25)
		expect(labels).toHaveLength(25)
		const firstOneAm = labels.indexOf("01:00")
		const secondOneAm = labels.lastIndexOf("01:00")
		expect(firstOneAm).toBeGreaterThanOrEqual(0)
		expect(secondOneAm).toBeGreaterThan(firstOneAm)

		const sessionStart = hourStarts[firstOneAm]!
		const sessionEnd = hourStarts[firstOneAm]! + 30 * 60 * 1000
		const hourlyMs = splitSessionIntoHourlyMs(
			sessionStart,
			sessionEnd,
			start,
			end,
			"America/New_York",
		)
		expect(hourlyMs[firstOneAm]).toBe(30 * 60 * 1000)
	})

	test("precomputed hourStarts match the internally built buckets", () => {
		const cases = [
			{ date: "2026-06-15", timeZone: "Asia/Shanghai" },
			{ date: "2024-03-10", timeZone: "America/New_York" }, // 23h spring day
			{ date: "2024-11-03", timeZone: "America/New_York" }, // 25h fall day
		] as const
		for (const { date, timeZone } of cases) {
			const { start, end } = getDayBounds(date, timeZone)
			const { hourStarts } = getDayHourBuckets(start, end, timeZone)
			const sessionStart = start + 90 * 60 * 1000
			const sessionEnd = start + 4 * 60 * 60 * 1000

			expect(
				splitSessionIntoHourlyMs(
					sessionStart,
					sessionEnd,
					start,
					end,
					timeZone,
					hourStarts,
				),
			).toEqual(
				splitSessionIntoHourlyMs(
					sessionStart,
					sessionEnd,
					start,
					end,
					timeZone,
				),
			)
		}
	})

	test("clips a session spanning the day bounds with precomputed hourStarts", () => {
		const from = Date.UTC(2026, 5, 15, 0, 0, 0)
		const to = from + 24 * 60 * 60 * 1000
		const { hourStarts } = getDayHourBuckets(from, to, "UTC")

		// Starts 30min before the day, ends 90min after the day start.
		const hourlyMs = splitSessionIntoHourlyMs(
			from - 30 * 60 * 1000,
			from + 90 * 60 * 1000,
			from,
			to,
			"UTC",
			hourStarts,
		)
		expect(hourlyMs[0]).toBe(60 * 60 * 1000)
		expect(hourlyMs[1]).toBe(30 * 60 * 1000)
		expect(hourlyMs.reduce((sum, ms) => sum + ms, 0)).toBe(90 * 60 * 1000)
	})
})

describe("calendar day helpers", () => {
	test("getCalendarWindowStart matches rolling seven-day window", () => {
		const nowMs = Date.UTC(2026, 5, 15, 10, 0, 0)
		const start = getCalendarWindowStart(nowMs, 7, "Asia/Shanghai")
		expect(start).toBe(Date.UTC(2026, 5, 8, 16, 0, 0))
	})

	test("calendarDaysSince counts whole local days", () => {
		const earlier = Date.UTC(2026, 5, 10, 23, 0, 0)
		const later = Date.UTC(2026, 5, 12, 1, 0, 0)
		expect(calendarDaysSince(earlier, later, "UTC")).toBe(2)
	})
})

describe("buildHourOfDayIndex", () => {
	const year = Date.UTC(2026, 0, 1)
	const yearEnd = Date.UTC(2027, 0, 1)

	test("single-entry table for a zone without DST", () => {
		const index = buildHourOfDayIndex(year, yearEnd, "Asia/Shanghai")
		expect(index.transitions).toHaveLength(1)
		expect(index.transitions[0]?.offsetMs).toBe(8 * 60 * 60 * 1000)
		for (const ts of [
			Date.UTC(2026, 0, 1, 0, 0),
			Date.UTC(2026, 5, 15, 4, 30),
			Date.UTC(2026, 11, 31, 16, 0),
		]) {
			expect(index.hourOfDay(ts)).toBe(dayjs(ts).tz("Asia/Shanghai").hour())
		}
	})

	test("captures both DST transitions in America/New_York", () => {
		const index = buildHourOfDayIndex(year, yearEnd, "America/New_York")
		expect(index.transitions).toHaveLength(3)
		const [first, spring, fall] = index.transitions
		expect(first?.offsetMs).toBe(-5 * 60 * 60 * 1000)
		expect(spring?.offsetMs).toBe(-4 * 60 * 60 * 1000)
		expect(fall?.offsetMs).toBe(-5 * 60 * 60 * 1000)
		expect(spring?.instant).toBe(Date.UTC(2026, 2, 8, 7, 0, 0))
		expect(fall?.instant).toBe(Date.UTC(2026, 10, 1, 6, 0, 0))
	})

	test("handles non-hour offsets (Asia/Kathmandu +05:45)", () => {
		const index = buildHourOfDayIndex(year, yearEnd, "Asia/Kathmandu")
		expect(index.transitions).toHaveLength(1)
		expect(index.transitions[0]?.offsetMs).toBe(345 * 60 * 1000)

		const ts = Date.UTC(2026, 5, 15, 4, 30, 0) // 10:15 local
		expect(index.hourOfDay(ts)).toBe(10)
		expect(index.hourStart(ts)).toBe(Date.UTC(2026, 5, 15, 4, 15, 0))
	})

	test("hourOfDay at the exact transition instant uses the new offset", () => {
		const index = buildHourOfDayIndex(year, yearEnd, "America/New_York")
		// Spring-forward: 02:00 EST jumps to 03:00 EDT at 07:00:00Z.
		expect(index.hourOfDay(Date.UTC(2026, 2, 8, 6, 59, 59, 999))).toBe(1)
		expect(index.hourOfDay(Date.UTC(2026, 2, 8, 7, 0, 0))).toBe(3)
		// Fall-back: 02:00 EDT falls back to 01:00 EST at 06:00:00Z —
		// both instants are hour 1 (the repeated hour).
		expect(index.hourOfDay(Date.UTC(2026, 10, 1, 5, 59, 59, 999))).toBe(1)
		expect(index.hourOfDay(Date.UTC(2026, 10, 1, 6, 0, 0))).toBe(1)
	})

	test("hourStart matches the true local hour floor around transitions", () => {
		const index = buildHourOfDayIndex(year, yearEnd, "America/New_York")
		// Wall-clock truncation oracle: ts minus its minutes/seconds/ms.
		const instants = [
			Date.UTC(2026, 0, 15, 10, 30, 0),
			Date.UTC(2026, 2, 8, 6, 55, 0),
			Date.UTC(2026, 2, 8, 7, 5, 0),
			Date.UTC(2026, 5, 15, 4, 30, 0),
			Date.UTC(2026, 10, 1, 5, 55, 0),
			Date.UTC(2026, 10, 1, 6, 5, 0),
			Date.UTC(2026, 11, 31, 16, 0, 0),
		]
		for (const ts of instants) {
			const d = dayjs(ts).tz("America/New_York")
			const expected =
				ts - (d.minute() * 60_000 + d.second() * 1000 + d.millisecond())
			expect(index.hourStart(ts)).toBe(expected)
		}
	})

	test("resolves instants at the window edges with the sampled offsets", () => {
		const index = buildHourOfDayIndex(year, yearEnd, "America/New_York")
		expect(index.hourOfDay(year - 1)).toBe(
			dayjs(year - 1)
				.tz("America/New_York")
				.hour(),
		)
		expect(index.hourOfDay(yearEnd)).toBe(
			dayjs(yearEnd).tz("America/New_York").hour(),
		)
	})

	test("captures a transition inside a window shorter than the sampling cadence", () => {
		// Two days around the fall-back day — no 7-day sample lands after
		// the transition, so the window-end pin must catch it.
		const from = Date.UTC(2026, 10, 1, 4, 0, 0)
		const to = Date.UTC(2026, 10, 3, 4, 0, 0)
		const index = buildHourOfDayIndex(from, to, "America/New_York")

		expect(index.transitions.map((t) => t.offsetMs)).toEqual([
			-4 * 60 * 60 * 1000,
			-5 * 60 * 60 * 1000,
		])
		expect(index.transitions[1]?.instant).toBe(Date.UTC(2026, 10, 1, 6, 0, 0))
		expect(index.hourOfDay(Date.UTC(2026, 10, 1, 6, 30, 0))).toBe(1)
		expect(index.hourOfDay(Date.UTC(2026, 10, 1, 7, 30, 0))).toBe(2)
	})
})

describe("splitSessionIntoHourOfDayMs", () => {
	test("a cross-midnight session lands in both hours", () => {
		const midnight = Date.UTC(2026, 5, 15, 0, 0, 0)
		const from = midnight - 24 * 60 * 60 * 1000
		const to = midnight + 24 * 60 * 60 * 1000

		const hourly = splitSessionIntoHourOfDayMs(
			midnight - 30 * 60 * 1000,
			midnight + 30 * 60 * 1000,
			from,
			to,
			"UTC",
		)
		expect(hourly).toHaveLength(24)
		expect(hourly[23]).toBe(30 * 60 * 1000)
		expect(hourly[0]).toBe(30 * 60 * 1000)
		expect(hourly.reduce((sum, ms) => sum + ms, 0)).toBe(60 * 60 * 1000)
	})

	test("clips the session to the window", () => {
		const from = Date.UTC(2026, 5, 15, 0, 0, 0)
		const to = from + 24 * 60 * 60 * 1000

		const hourly = splitSessionIntoHourOfDayMs(
			from - 2 * 60 * 60 * 1000,
			from + 2 * 60 * 60 * 1000,
			from,
			to,
			"UTC",
		)
		expect(hourly[0]).toBe(60 * 60 * 1000)
		expect(hourly[1]).toBe(60 * 60 * 1000)
		expect(hourly.reduce((sum, ms) => sum + ms, 0)).toBe(2 * 60 * 60 * 1000)
	})

	test("builds the index internally when none is passed", () => {
		const year = Date.UTC(2026, 0, 1)
		const yearEnd = Date.UTC(2027, 0, 1)
		const index = buildHourOfDayIndex(year, yearEnd, "America/New_York")
		const start = Date.UTC(2026, 9, 25, 5, 30, 0)
		const end = start + 3 * 60 * 60 * 1000

		expect(
			splitSessionIntoHourOfDayMs(
				start,
				end,
				year,
				yearEnd,
				"America/New_York",
				index,
			),
		).toEqual(
			splitSessionIntoHourOfDayMs(
				start,
				end,
				year,
				yearEnd,
				"America/New_York",
			),
		)
	})

	test("returns all zeros for a session fully outside the window", () => {
		const from = Date.UTC(2026, 5, 15, 0, 0, 0)
		const to = from + 24 * 60 * 60 * 1000

		const before = splitSessionIntoHourOfDayMs(
			from - 2 * 60 * 60 * 1000,
			from - 60 * 60 * 1000,
			from,
			to,
			"UTC",
		)
		const after = splitSessionIntoHourOfDayMs(
			to + 60 * 60 * 1000,
			to + 2 * 60 * 60 * 1000,
			from,
			to,
			"UTC",
		)
		expect(before.every((ms) => ms === 0)).toBe(true)
		expect(after.every((ms) => ms === 0)).toBe(true)
	})

	test("a session exactly matching the window sums to its duration", () => {
		const from = Date.UTC(2026, 5, 15, 0, 0, 0)
		const to = from + 3 * 60 * 60 * 1000

		const hourly = splitSessionIntoHourOfDayMs(from, to, from, to, "UTC")
		expect(hourly[0]).toBe(60 * 60 * 1000)
		expect(hourly[1]).toBe(60 * 60 * 1000)
		expect(hourly[2]).toBe(60 * 60 * 1000)
		expect(hourly.reduce((sum, ms) => sum + ms, 0)).toBe(to - from)
	})

	test("buckets by wall hour in a non-hour offset zone", () => {
		const from = Date.UTC(2026, 5, 15, 0, 0, 0)
		const to = Date.UTC(2026, 5, 16, 0, 0, 0)

		// 10:15–11:15 Kathmandu (+05:45): 45min in hour 10, 15min in hour 11.
		const hourly = splitSessionIntoHourOfDayMs(
			Date.UTC(2026, 5, 15, 4, 30, 0),
			Date.UTC(2026, 5, 15, 5, 30, 0),
			from,
			to,
			"Asia/Kathmandu",
		)
		expect(hourly[10]).toBe(45 * 60 * 1000)
		expect(hourly[11]).toBe(15 * 60 * 1000)
		expect(hourly.reduce((sum, ms) => sum + ms, 0)).toBe(60 * 60 * 1000)
	})

	test("spring-forward day skips hour 2; fall-back day repeats hour 1", () => {
		const index = buildHourOfDayIndex(
			Date.UTC(2026, 0, 1),
			Date.UTC(2027, 0, 1),
			"America/New_York",
		)

		// 01:00–03:00 EST then 03:00–04:00 EDT on Mar 8 2026.
		const spring = splitSessionIntoHourOfDayMs(
			Date.UTC(2026, 2, 8, 6, 0, 0),
			Date.UTC(2026, 2, 8, 8, 0, 0),
			Date.UTC(2026, 2, 7, 0, 0, 0),
			Date.UTC(2026, 2, 9, 0, 0, 0),
			"America/New_York",
			index,
		)
		expect(spring[1]).toBe(60 * 60 * 1000)
		expect(spring[2]).toBe(0)
		expect(spring[3]).toBe(60 * 60 * 1000)

		// 01:00 EDT, then the repeated 01:00 EST, then 02:00 EST on Nov 1.
		const fall = splitSessionIntoHourOfDayMs(
			Date.UTC(2026, 10, 1, 5, 0, 0),
			Date.UTC(2026, 10, 1, 8, 0, 0),
			Date.UTC(2026, 9, 31, 0, 0, 0),
			Date.UTC(2026, 11, 2, 0, 0, 0),
			"America/New_York",
			index,
		)
		expect(fall[1]).toBe(2 * 60 * 60 * 1000)
		expect(fall[2]).toBe(60 * 60 * 1000)
		expect(fall.reduce((sum, ms) => sum + ms, 0)).toBe(3 * 60 * 60 * 1000)
	})

	test("matches true wall-clock hours across a DST-heavy year", () => {
		// Oracle: true wall-clock attribution — each real-hour slice is
		// credited to the zone's hour at the slice's midpoint, resolved
		// with a fresh dayjs conversion (per-instant offset, DST-aware).
		// Hour floors are computed by truncating the wall-clock time
		// (dayjs's startOf() on tz instances is unreliable when the host
		// zone differs from the target zone).
		function hourFloor(ts: number): number {
			const d = dayjs(ts).tz(timeZone)
			return ts - (d.minute() * 60_000 + d.second() * 1000 + d.millisecond())
		}
		function reference(
			startedAt: number,
			endedAt: number,
			from: number,
			to: number,
		): number[] {
			const hourly = Array.from({ length: 24 }, () => 0)
			const overlapStart = Math.max(startedAt, from)
			const overlapEnd = Math.min(endedAt, to)
			if (overlapEnd <= overlapStart) return hourly
			let cursor = hourFloor(overlapStart)
			while (cursor < overlapEnd) {
				const segmentStart = Math.max(cursor, overlapStart)
				const segmentEnd = Math.min(cursor + 3_600_000, overlapEnd)
				if (segmentEnd > segmentStart) {
					const hour = dayjs(Math.floor((segmentStart + segmentEnd) / 2))
						.tz(timeZone)
						.hour()
					hourly[hour] = (hourly[hour] ?? 0) + (segmentEnd - segmentStart)
				}
				cursor += 3_600_000
			}
			return hourly
		}

		const timeZone = "America/New_York"
		const year = Date.UTC(2026, 0, 1)
		const yearEnd = Date.UTC(2027, 0, 1)
		const index = buildHourOfDayIndex(year, yearEnd, timeZone)

		// Sessions of varied lengths and offsets across the whole year,
		// including both DST transition days (Mar 8 and Nov 1, 2026).
		const startTimes: number[] = []
		const anchor = year
		for (let day = 0; day < 365; day += 3) {
			for (const hour of [0, 6, 12, 18, 23]) {
				startTimes.push(anchor + day * 86_400_000 + hour * 3_600_000)
			}
		}
		// Edge instants: just before/after each transition, inside the
		// repeated fall-back hour, and the very end of the window.
		startTimes.push(
			Date.UTC(2026, 2, 8, 6, 55, 0),
			Date.UTC(2026, 2, 8, 7, 5, 0),
			Date.UTC(2026, 10, 1, 5, 55, 0),
			Date.UTC(2026, 10, 1, 6, 5, 0),
			Date.UTC(2026, 10, 1, 6, 30, 0),
			yearEnd - 60_000,
		)

		for (const start of startTimes) {
			for (const durationMs of [
				10 * 60_000,
				45 * 60_000,
				3 * 3_600_000,
				26 * 3_600_000,
			]) {
				const actual = splitSessionIntoHourOfDayMs(
					start,
					start + durationMs,
					year,
					yearEnd,
					timeZone,
					index,
				)
				const expected = reference(start, start + durationMs, year, yearEnd)
				expect(actual).toEqual(expected)
			}
		}
	})
})
