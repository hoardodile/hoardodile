import { act, renderHook } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
import type { Translate } from "@/i18n"
import { syncBrowserTimeZone } from "@/lib/timezone"
import {
	formatDate,
	formatDateTime,
	formatDateTrait,
	useResolvedTimeZone,
	yearlessDatePart,
} from "../datePrefs"

vi.mock("@/hooks/usePrefSync", () => ({
	useStringPrefSync: (_key: string, defaultValue: string) => [
		defaultValue,
		vi.fn(),
	],
}))

describe("date formatting helpers", () => {
	// 2024-06-12 14:30:00 UTC
	const ts = Date.UTC(2024, 5, 12, 14, 30, 0)

	test("formatDateTime respects format and UTC timezone", () => {
		expect(formatDateTime(ts, "YYYY-MM-DD HH:mm:ss", "UTC")).toBe(
			"2024-06-12 14:30:00",
		)
		expect(formatDateTime(ts, "YYYY/MM/DD HH:mm:ss", "UTC")).toBe(
			"2024/06/12 14:30:00",
		)
	})

	test("formatDateTime resolves local sentinel via browser zone", () => {
		vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
			timeZone: "Asia/Shanghai",
		} as Intl.ResolvedDateTimeFormatOptions)
		syncBrowserTimeZone()
		const shanghaiTs = Date.UTC(2024, 5, 11, 16, 30, 0)
		expect(formatDateTime(shanghaiTs, "YYYY-MM-DD HH:mm:ss", "local")).toBe(
			"2024-06-12 00:30:00",
		)
		vi.restoreAllMocks()
	})

	test("formatDate strips time portion from format", () => {
		expect(formatDate(ts, "YYYY-MM-DD HH:mm:ss", "UTC")).toBe("2024-06-12")
		expect(formatDate(ts, "DD/MM/YYYY HH:mm:ss", "UTC")).toBe("12/06/2024")
	})

	test("yearlessDatePart removes the year and one adjacent separator", () => {
		expect(yearlessDatePart("YYYY-MM-DD HH:mm:ss")).toBe("MM-DD HH:mm:ss")
		expect(yearlessDatePart("YYYY/MM/DD HH:mm:ss")).toBe("MM/DD HH:mm:ss")
		expect(yearlessDatePart("DD/MM/YYYY HH:mm:ss")).toBe("DD/MM HH:mm:ss")
		expect(yearlessDatePart("MM/DD/YYYY HH:mm:ss")).toBe("MM/DD HH:mm:ss")
		// No year token (or nothing left): unchanged.
		expect(yearlessDatePart("MM-DD HH:mm:ss")).toBe("MM-DD HH:mm:ss")
		expect(yearlessDatePart("YYYY")).toBe("YYYY")
	})

	test("formatDateTime hides the year for dates in the current calendar year", () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 5, 12, 12, 0, 0) })
		const currentYearTs = Date.UTC(2026, 5, 12, 14, 30, 0)
		expect(formatDateTime(currentYearTs, "YYYY-MM-DD HH:mm:ss", "UTC")).toBe(
			"06-12 14:30:00",
		)
		expect(formatDateTime(currentYearTs, "YYYY/MM/DD HH:mm:ss", "UTC")).toBe(
			"06/12 14:30:00",
		)
		expect(formatDateTime(currentYearTs, "DD/MM/YYYY HH:mm:ss", "UTC")).toBe(
			"12/06 14:30:00",
		)
		expect(formatDateTime(currentYearTs, "MM/DD/YYYY HH:mm:ss", "UTC")).toBe(
			"06/12 14:30:00",
		)
		expect(formatDate(currentYearTs, "YYYY-MM-DD HH:mm:ss", "UTC")).toBe(
			"06-12",
		)
		vi.useRealTimers()
	})

	test("formatDateTime keeps the year for dates in another year", () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 5, 12, 12, 0, 0) })
		expect(formatDateTime(ts, "YYYY-MM-DD HH:mm:ss", "UTC")).toBe(
			"2024-06-12 14:30:00",
		)
		vi.useRealTimers()
	})

	test("year hiding follows the formatted zone's calendar year", () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 5, 12, 12, 0, 0) })
		// 2025-12-31 16:30 UTC is 2026-01-01 00:30 in Shanghai.
		const newYearEve = Date.UTC(2025, 11, 31, 16, 30, 0)
		expect(
			formatDateTime(newYearEve, "YYYY-MM-DD HH:mm:ss", "Asia/Shanghai"),
		).toBe("01-01 00:30:00")
		expect(formatDateTime(newYearEve, "YYYY-MM-DD HH:mm:ss", "UTC")).toBe(
			"2025-12-31 16:30:00",
		)
		vi.useRealTimers()
	})

	test("formatDateTrait renders prefix and sign label", () => {
		const t = ((key: string) =>
			key === "traits.values.date.before" ? "BC" : key) as Translate
		expect(
			formatDateTrait(
				{ prefix: "AD", sign: "+", year: 2024, month: 6, day: 12 },
				"YYYY-MM-DD HH:mm:ss",
				t as unknown as Translate,
			),
		).toBe("AD 2024-6-12")
		expect(
			formatDateTrait(
				{ prefix: "", sign: "-", year: 100, month: 1, day: 15 },
				"YYYY-MM-DD HH:mm:ss",
				t as unknown as Translate,
			),
		).toBe("BC 100-1-15")
	})

	test("formatDateTrait renders partial dates", () => {
		const t = ((key: string) =>
			key === "traits.values.date.before" ? "BC" : key) as Translate
		expect(
			formatDateTrait(
				{ prefix: "", sign: "+", year: 2000, month: undefined, day: undefined },
				"YYYY-MM-DD HH:mm:ss",
				t as unknown as Translate,
			),
		).toBe("2000-?-?")
		expect(
			formatDateTrait(
				{ prefix: "", sign: "+", year: 2000, month: 6, day: undefined },
				"YYYY-MM-DD HH:mm:ss",
				t as unknown as Translate,
			),
		).toBe("2000-6-?")
		expect(
			formatDateTrait(
				{ prefix: "", sign: "+", year: undefined, month: 6, day: 12 },
				"YYYY-MM-DD HH:mm:ss",
				t as unknown as Translate,
			),
		).toBe("?-6-12")
		expect(
			formatDateTrait(
				{
					prefix: "Era",
					sign: "-",
					year: undefined,
					month: 6,
					day: undefined,
				},
				"YYYY-MM-DD HH:mm:ss",
				t as unknown as Translate,
			),
		).toBe("Era BC ?-6-?")
		expect(
			formatDateTrait(
				{ prefix: "", sign: "+", year: undefined, month: undefined, day: 12 },
				"YYYY-MM-DD HH:mm:ss",
				t as unknown as Translate,
			),
		).toBe("?-?-12")
	})

	test("formatDateTrait renders fictional full dates without rollover", () => {
		const t = ((key: string) =>
			key === "traits.values.date.before" ? "BC" : key) as Translate
		// 13th month should not roll over to next year.
		expect(
			formatDateTrait(
				{ prefix: "", sign: "+", year: 2024, month: 13, day: 1 },
				"YYYY-MM-DD HH:mm:ss",
				t as unknown as Translate,
			),
		).toBe("2024-13-1")
		// Feb 30th should not roll over to March.
		expect(
			formatDateTrait(
				{ prefix: "", sign: "+", year: 2024, month: 2, day: 30 },
				"YYYY-MM-DD HH:mm:ss",
				t as unknown as Translate,
			),
		).toBe("2024-2-30")
		// Different user date format is ignored; trait dates use fixed Y-M-D.
		expect(
			formatDateTrait(
				{ prefix: "", sign: "+", year: 2024, month: 2, day: 30 },
				"DD/MM/YYYY HH:mm:ss",
				t as unknown as Translate,
			),
		).toBe("2024-2-30")
		// BC fictional date keeps sign label.
		expect(
			formatDateTrait(
				{ prefix: "", sign: "-", year: 100, month: 13, day: 5 },
				"YYYY-MM-DD HH:mm:ss",
				t as unknown as Translate,
			),
		).toBe("BC 100-13-5")
	})

	test("formatDateTrait renders fictional partial dates", () => {
		const t = ((key: string) =>
			key === "traits.values.date.before" ? "BC" : key) as Translate
		expect(
			formatDateTrait(
				{ prefix: "", sign: "+", year: 2024, month: 13, day: undefined },
				"YYYY-MM-DD HH:mm:ss",
				t as unknown as Translate,
			),
		).toBe("2024-13-?")
		expect(
			formatDateTrait(
				{ prefix: "", sign: "+", year: undefined, month: 2, day: 30 },
				"YYYY-MM-DD HH:mm:ss",
				t as unknown as Translate,
			),
		).toBe("?-2-30")
		expect(
			formatDateTrait(
				{ prefix: "", sign: "+", year: undefined, month: 13, day: undefined },
				"YYYY-MM-DD HH:mm:ss",
				t as unknown as Translate,
			),
		).toBe("?-13-?")
	})
})

describe("useResolvedTimeZone", () => {
	test("re-resolves local pref when browser zone changes on visibility", () => {
		const intlSpy = vi
			.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
			.mockReturnValue({
				timeZone: "Asia/Shanghai",
			} as Intl.ResolvedDateTimeFormatOptions)
		syncBrowserTimeZone()

		const { result, rerender } = renderHook(() => useResolvedTimeZone())
		expect(result.current).toBe("Asia/Shanghai")

		intlSpy.mockReturnValue({
			timeZone: "Europe/Berlin",
		} as Intl.ResolvedDateTimeFormatOptions)

		act(() => {
			syncBrowserTimeZone()
		})
		rerender()
		expect(result.current).toBe("Europe/Berlin")

		vi.restoreAllMocks()
	})
})
