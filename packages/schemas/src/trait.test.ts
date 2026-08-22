import { describe, expect, test } from "vitest"
import {
	computeDateOrder,
	computeDateOrderRange,
	parseTraitValue,
	traitDef,
	traitFilter,
} from "./trait.ts"

const valid = {
	id: "tr_1",
	name: "Height",
	kind: "height" as const,
	position: 0,
	pinned: false,
	color: "",
	intro: "",
	createdAt: 1,
	updatedAt: 2,
}

describe("traitDef schema", () => {
	test("parses a valid trait definition", () => {
		const parsed = traitDef.parse(valid)
		expect(parsed.name).toBe("Height")
		expect(parsed.color).toBe("")
	})

	test("defaults color to empty string", () => {
		const { color, ...rest } = valid
		void color
		expect(traitDef.parse(rest).color).toBe("")
	})

	test("rejects color > 100 chars", () => {
		expect(
			traitDef.safeParse({ ...valid, color: `#${"a".repeat(100)}` }).success,
		).toBe(false)
	})
})

describe("parseTraitValue date", () => {
	const raw = JSON.stringify({ p: "AD", s: "+", y: 2024, m: 6, d: 12 })

	test("parses a date value", () => {
		const parsed = parseTraitValue("date", raw)
		expect(parsed.kind).toBe("date")
		if (parsed.kind !== "date") return
		expect(parsed.prefix).toBe("AD")
		expect(parsed.sign).toBe("+")
		expect(parsed.year).toBe(2024)
		expect(parsed.month).toBe(6)
		expect(parsed.day).toBe(12)
		expect(Number.isFinite(parsed.order)).toBe(true)
	})

	test("converts BC sign to negative astronomical year", () => {
		const bc = JSON.stringify({ p: "AD", s: "-", y: 1, m: 1, d: 1 })
		const parsed = parseTraitValue("date", bc)
		expect(parsed.kind).toBe("date")
		if (parsed.kind !== "date") return
		expect(parsed.sign).toBe("-")
		const ad = JSON.stringify({ p: "AD", s: "+", y: 1, m: 1, d: 1 })
		const adParsed = parseTraitValue("date", ad)
		expect(adParsed.kind).toBe("date")
		if (adParsed.kind !== "date") return
		expect(parsed.order).toBeLessThan(adParsed.order)
	})

	test("rejects non-positive date components", () => {
		// A component that is present must be a positive integer.
		expect(() =>
			parseTraitValue(
				"date",
				JSON.stringify({ p: "x", s: "+", y: 0, m: 0, d: 0 }),
			),
		).toThrow()
		expect(() =>
			parseTraitValue(
				"date",
				JSON.stringify({ p: "x", s: "+", y: -1, m: -2, d: -3 }),
			),
		).toThrow()
		expect(() =>
			parseTraitValue("date", JSON.stringify({ p: "x", s: "+", y: -1 })),
		).toThrow()
		expect(() =>
			parseTraitValue(
				"date",
				JSON.stringify({ p: "x", s: "+", y: 2024, m: 2, d: 0 }),
			),
		).toThrow()
		expect(() =>
			parseTraitValue(
				"date",
				JSON.stringify({ p: "x", s: "+", y: 2024, m: -1, d: 1 }),
			),
		).toThrow()
		expect(() =>
			parseTraitValue(
				"date",
				JSON.stringify({ p: "x", s: "+", y: 2024, m: 2, d: -1 }),
			),
		).toThrow()
		expect(() =>
			parseTraitValue(
				"date",
				JSON.stringify({ p: "x", s: "+", y: 2024, m: 2, d: 1.5 }),
			),
		).toThrow()
	})

	test("rejects mixed negative and fictional-positive components", () => {
		// Even when some components look like valid fictional values, any
		// negative component must cause the whole date to be rejected.
		expect(() =>
			parseTraitValue(
				"date",
				JSON.stringify({ p: "x", s: "+", y: -1, m: 2, d: 30 }),
			),
		).toThrow()
		expect(() =>
			parseTraitValue(
				"date",
				JSON.stringify({ p: "x", s: "+", y: 2024, m: -1, d: 30 }),
			),
		).toThrow()
		expect(() =>
			parseTraitValue(
				"date",
				JSON.stringify({ p: "x", s: "+", y: 2024, m: 13, d: -1 }),
			),
		).toThrow()
	})

	test("accepts out-of-bounds fictional dates", () => {
		const month13 = parseTraitValue(
			"date",
			JSON.stringify({ p: "x", s: "+", y: 2024, m: 13, d: 1 }),
		)
		expect(month13.kind).toBe("date")
		if (month13.kind !== "date") return
		expect(month13.month).toBe(13)
		expect(Number.isFinite(month13.order)).toBe(true)

		const feb30 = parseTraitValue(
			"date",
			JSON.stringify({ p: "x", s: "+", y: 2024, m: 2, d: 30 }),
		)
		expect(feb30.kind).toBe("date")
		if (feb30.kind !== "date") return
		expect(feb30.day).toBe(30)
		expect(Number.isFinite(feb30.order)).toBe(true)

		// Feb 29th on a non-leap year is invalid Gregorian but valid as a
		// fictional date.
		const feb29_2023 = parseTraitValue(
			"date",
			JSON.stringify({ p: "x", s: "+", y: 2023, m: 2, d: 29 }),
		)
		expect(feb29_2023.kind).toBe("date")
		if (feb29_2023.kind !== "date") return
		expect(feb29_2023.day).toBe(29)
		expect(Number.isFinite(feb29_2023.order)).toBe(true)
	})

	test("allows empty or omitted prefix", () => {
		const omitted = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", y: 2024, m: 6, d: 12 }),
		)
		expect(omitted.kind).toBe("date")
		if (omitted.kind !== "date") return
		expect(omitted.prefix).toBe("")

		const empty = parseTraitValue(
			"date",
			JSON.stringify({ p: "", s: "+", y: 2024, m: 6, d: 12 }),
		)
		expect(empty.kind).toBe("date")
		if (empty.kind !== "date") return
		expect(empty.prefix).toBe("")
	})

	test("rejects invalid JSON", () => {
		expect(() => parseTraitValue("date", "not-json")).toThrow()
		expect(() => parseTraitValue("date", "{}")).toThrow()
	})

	test("parses date with only sign and prefix", () => {
		const signOnly = parseTraitValue("date", JSON.stringify({ s: "-" }))
		expect(signOnly.kind).toBe("date")
		if (signOnly.kind !== "date") return
		expect(signOnly.sign).toBe("-")
		expect(signOnly.prefix).toBe("")
		expect(signOnly.year).toBeUndefined()
		expect(signOnly.month).toBeUndefined()
		expect(signOnly.day).toBeUndefined()
		expect(Number.isFinite(signOnly.order)).toBe(true)

		const withPrefix = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", p: "Fictional Era" }),
		)
		expect(withPrefix.kind).toBe("date")
		if (withPrefix.kind !== "date") return
		expect(withPrefix.sign).toBe("+")
		expect(withPrefix.prefix).toBe("Fictional Era")
		expect(Number.isFinite(withPrefix.order)).toBe(true)
	})

	test("parses partial dates", () => {
		const yearOnly = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", y: 2000 }),
		)
		expect(yearOnly.kind).toBe("date")
		if (yearOnly.kind !== "date") return
		expect(yearOnly.year).toBe(2000)
		expect(yearOnly.month).toBeUndefined()
		expect(yearOnly.day).toBeUndefined()
		expect(Number.isFinite(yearOnly.order)).toBe(true)

		const yearMonth = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", y: 2000, m: 6 }),
		)
		expect(yearMonth.kind).toBe("date")
		if (yearMonth.kind !== "date") return
		expect(yearMonth.year).toBe(2000)
		expect(yearMonth.month).toBe(6)
		expect(yearMonth.day).toBeUndefined()

		const monthDay = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", m: 6, d: 12 }),
		)
		expect(monthDay.kind).toBe("date")
		if (monthDay.kind !== "date") return
		expect(monthDay.year).toBeUndefined()
		expect(monthDay.month).toBe(6)
		expect(monthDay.day).toBe(12)

		// Year-less February 29th should be accepted so birthdays work even
		// when the user does not know the birth year.
		const feb29 = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", m: 2, d: 29 }),
		)
		expect(feb29.kind).toBe("date")
		if (feb29.kind !== "date") return
		expect(feb29.month).toBe(2)
		expect(feb29.day).toBe(29)
	})

	test("order uses earliest possible date for partial values", () => {
		const full = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", y: 2000, m: 6, d: 12 }),
		)
		const yearOnly = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", y: 2000 }),
		)
		const yearMonth = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", y: 2000, m: 6 }),
		)
		const monthDay = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", m: 2, d: 29 }),
		)
		if (
			full.kind !== "date" ||
			yearOnly.kind !== "date" ||
			yearMonth.kind !== "date" ||
			monthDay.kind !== "date"
		)
			return
		expect(yearOnly.order).toBe(
			computeDateOrder({ sign: "+", year: 2000, month: 1, day: 1 }),
		)
		expect(yearMonth.order).toBe(
			computeDateOrder({ sign: "+", year: 2000, month: 6, day: 1 }),
		)
		// Year-less dates sort against a leap astronomical year 4 so Feb 29 is valid.
		expect(monthDay.order).toBe(
			computeDateOrder({ sign: "+", year: 4, month: 2, day: 29 }),
		)
		expect(yearOnly.order).toBeLessThan(yearMonth.order)
		expect(yearMonth.order).toBeLessThan(full.order)
	})

	test("fictional dates use fallback ordering outside the JDN range", () => {
		const gregorian = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", y: 2000, m: 1, d: 1 }),
		)
		const fictional = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", y: 2000, m: 2, d: 30 }),
		)
		const futureFictional = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", y: 2000, m: 13, d: 1 }),
		)
		const bcFictional = parseTraitValue(
			"date",
			JSON.stringify({ s: "-", y: 100, m: 2, d: 30 }),
		)
		if (
			gregorian.kind !== "date" ||
			fictional.kind !== "date" ||
			futureFictional.kind !== "date" ||
			bcFictional.kind !== "date"
		)
			return
		// Fallback ordinals sit above all valid JDN values for AD dates.
		expect(fictional.order).toBeGreaterThan(gregorian.order)
		expect(futureFictional.order).toBeGreaterThan(fictional.order)
		// BC fallback ordinals sit below the JDN range.
		expect(bcFictional.order).toBeLessThan(gregorian.order)
		expect(Number.isFinite(bcFictional.order)).toBe(true)
	})

	test("computeDateOrderRange spans the known period", () => {
		const yearRange = computeDateOrderRange({ sign: "+", year: 2000 })
		expect(yearRange.min).toBe(
			computeDateOrder({ sign: "+", year: 2000, month: 1, day: 1 }),
		)
		expect(yearRange.max).toBe(
			computeDateOrder({ sign: "+", year: 2000, month: 12, day: 31 }),
		)

		const monthRange = computeDateOrderRange({
			sign: "+",
			year: 2000,
			month: 2,
		})
		expect(monthRange.min).toBe(
			computeDateOrder({ sign: "+", year: 2000, month: 2, day: 1 }),
		)
		expect(monthRange.max).toBe(
			computeDateOrder({ sign: "+", year: 2000, month: 2, day: 29 }),
		)

		const noYear = computeDateOrderRange({ sign: "+", month: 6, day: 12 })
		// Unknown-year dates sort against leap astronomical year 4.
		expect(noYear.min).toBe(
			computeDateOrder({ sign: "+", year: 4, month: 6, day: 12 }),
		)
		expect(noYear.max).toBe(Number.POSITIVE_INFINITY)
	})

	test("Gregorian order is unchanged by fictional-date support", () => {
		const cases = [
			{ sign: "+" as const, year: 1, month: 1, day: 1 },
			{ sign: "+" as const, year: 2000, month: 6, day: 12 },
			{ sign: "+" as const, year: 2000, month: 2, day: 29 },
			{ sign: "+" as const, year: 2023, month: 2, day: 28 },
			{ sign: "-" as const, year: 1, month: 1, day: 1 },
			{ sign: "-" as const, year: 100, month: 12, day: 31 },
			{ sign: "+" as const, year: 2000 },
			{ sign: "+" as const, year: 2000, month: 6 },
			{ sign: "+" as const, month: 2, day: 29 },
		]
		for (const c of cases) {
			const parsed = parseTraitValue(
				"date",
				JSON.stringify({ s: c.sign, y: c.year, m: c.month, d: c.day }),
			)
			expect(parsed.kind).toBe("date")
			if (parsed.kind !== "date") return
			expect(parsed.order).toBe(computeDateOrder(c))
		}
	})

	test("fictional dates order deterministically within a sign", () => {
		const feb30 = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", y: 2000, m: 2, d: 30 }),
		)
		const month13 = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", y: 2000, m: 13, d: 1 }),
		)
		const day100 = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", y: 2000, m: 1, d: 100 }),
		)
		const feb31 = parseTraitValue(
			"date",
			JSON.stringify({ s: "+", y: 2000, m: 2, d: 31 }),
		)
		if (
			feb30.kind !== "date" ||
			month13.kind !== "date" ||
			day100.kind !== "date" ||
			feb31.kind !== "date"
		)
			return
		for (const v of [feb30, month13, day100, feb31]) {
			expect(Number.isFinite(v.order)).toBe(true)
		}
		// All are AD 2000, so order follows (month, day) lexicographically.
		expect(feb30.order).toBeGreaterThan(day100.order)
		expect(feb31.order).toBeGreaterThan(feb30.order)
		expect(month13.order).toBeGreaterThan(feb31.order)
	})

	test("computeDateOrderRange collapses fictional dates to a point", () => {
		const range = computeDateOrderRange({
			sign: "+",
			year: 2024,
			month: 2,
			day: 30,
		})
		expect(Number.isFinite(range.min)).toBe(true)
		expect(range.min).toBe(range.max)
	})
})

describe("traitFilter schema", () => {
	test("accepts dateMonthDayToday filter", () => {
		const parsed = traitFilter.parse({
			traitId: "t1",
			op: "dateMonthDayToday",
		})
		expect(parsed.op).toBe("dateMonthDayToday")
		expect(parsed.traitId).toBe("t1")
	})

	test("accepts contains filter with empty value", () => {
		const parsed = traitFilter.parse({
			traitId: "t1",
			op: "contains",
			value: "",
		})
		expect(parsed.op).toBe("contains")
		expect(parsed.traitId).toBe("t1")
		if (parsed.op !== "contains") return
		expect(parsed.value).toBe("")
	})
})
