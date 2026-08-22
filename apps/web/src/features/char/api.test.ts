/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"
import { formatCalendarDay, getCalendarMonthDay } from "@/lib/timezone"
import {
	charListCalendarDay,
	charListCalendarTimeZone,
	charListQueryOptions,
} from "./api"

describe("char list trait filter normalization", () => {
	beforeEach(() => {
		prefSync.set(prefKeys.timeZone, "UTC")
	})

	test("dateMonthDayToday stays in query key with calendarTimeZone and calendarDay", () => {
		const options = charListQueryOptions({
			trash: false,
			query: "",
			page: 1,
			traitFilters: [{ traitId: "trait-birthday", op: "dateMonthDayToday" }],
			calendarTimeZone: "UTC",
			calendarDay: "2024-06-12",
		})

		const listKey = (options.queryKey as unknown as readonly unknown[])[2] as {
			readonly traitFilters?: readonly {
				readonly op: string
				readonly value?: { month: number; day: number }
			}[]
			readonly calendarTimeZone?: string
			readonly calendarDay?: string
		}
		expect(listKey.traitFilters).toEqual([
			{ traitId: "trait-birthday", op: "dateMonthDayToday" },
		])
		expect(listKey.calendarTimeZone).toBe("UTC")
		expect(listKey.calendarDay).toBe("2024-06-12")
	})

	test("getCalendarMonthDay matches prior dateMonthDayOn conversion", () => {
		const fixedNow = Date.UTC(2024, 5, 12, 14, 0, 0)
		vi.spyOn(Date, "now").mockReturnValue(fixedNow)
		expect(getCalendarMonthDay(fixedNow, "UTC")).toEqual({ month: 6, day: 12 })
		vi.restoreAllMocks()
	})

	test("calendarDay in key changes when calendar day changes", () => {
		const fixedNow = Date.UTC(2024, 5, 12, 23, 0, 0)
		vi.spyOn(Date, "now").mockReturnValue(fixedNow)
		const dayOne = formatCalendarDay(fixedNow, "UTC")

		vi.spyOn(Date, "now").mockReturnValue(fixedNow + 2 * 60 * 60 * 1000)
		const dayTwo = formatCalendarDay(Date.now(), "UTC")

		expect(dayOne).toBe("2024-06-12")
		expect(dayTwo).toBe("2024-06-13")

		const keyOne = charListQueryOptions({
			trash: false,
			query: "",
			page: 1,
			traitFilters: [{ traitId: "trait-birthday", op: "dateMonthDayToday" }],
			calendarTimeZone: "UTC",
			calendarDay: dayOne,
		}).queryKey

		const keyTwo = charListQueryOptions({
			trash: false,
			query: "",
			page: 1,
			traitFilters: [{ traitId: "trait-birthday", op: "dateMonthDayToday" }],
			calendarTimeZone: "UTC",
			calendarDay: dayTwo,
		}).queryKey

		expect(keyOne).not.toEqual(keyTwo)
		vi.restoreAllMocks()
	})
})

describe("charListCalendarTimeZone", () => {
	test("returns resolved zone only for dateMonthDayToday filters", () => {
		expect(charListCalendarTimeZone(undefined, "UTC")).toBeUndefined()
		expect(
			charListCalendarTimeZone(
				[{ traitId: "trait-age", op: "=", value: 1 }],
				"UTC",
			),
		).toBeUndefined()
		expect(
			charListCalendarTimeZone(
				[{ traitId: "trait-birthday", op: "dateMonthDayToday" }],
				"Asia/Shanghai",
			),
		).toBe("Asia/Shanghai")
	})
})

describe("charListCalendarDay", () => {
	test("returns calendar day only for dateMonthDayToday filters", () => {
		expect(charListCalendarDay(undefined, "2024-06-12")).toBeUndefined()
		expect(
			charListCalendarDay(
				[{ traitId: "trait-age", op: "=", value: 1 }],
				"2024-06-12",
			),
		).toBeUndefined()
		expect(
			charListCalendarDay(
				[{ traitId: "trait-birthday", op: "dateMonthDayToday" }],
				"2024-06-12",
			),
		).toBe("2024-06-12")
	})
})
