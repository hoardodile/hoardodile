import { z } from "zod"
import { id, timestamp } from "./primitives.ts"
import {
	MAX_COLOR_LENGTH,
	MAX_INTRO_LENGTH,
	MAX_TRAIT_FILTER_VALUE_LENGTH,
	MAX_TRAIT_NAME_LENGTH,
} from "./text-limits.ts"

export const TRAIT_KINDS = [
	"text",
	"multitext",
	"number",
	"height",
	"weight",
	"date",
] as const

export type TraitKind = (typeof TRAIT_KINDS)[number]

/**
 * Schema for a trait definition. A trait is a named, typed attribute that
 * can be attached to a character. The `kind` determines how the raw string
 * value stored on the character is parsed and sorted.
 */
export const traitDef = z.object({
	id,
	name: z.string().min(1).max(MAX_TRAIT_NAME_LENGTH),
	kind: z.enum(TRAIT_KINDS),
	position: z.number().int().nonnegative(),
	pinned: z.boolean(),
	color: z.string().max(MAX_COLOR_LENGTH).default(""),
	intro: z.string().max(MAX_INTRO_LENGTH).default(""),
	createdAt: timestamp,
	updatedAt: timestamp,
})

export type TraitDef = z.infer<typeof traitDef>

/**
 * A parsed trait value. The `kind` discriminant mirrors the parent
 * {@link TraitDef}'s kind and determines which structural fields are present.
 * Comparable kinds expose an `order` number suitable for range queries and
 * sorting.
 */
export type TraitValue =
	| { kind: "text"; raw: string }
	| { kind: "multitext"; raw: string; values: readonly string[] }
	| { kind: "number"; raw: string; order: number }
	| { kind: "height"; raw: string; cm: number; order: number }
	| { kind: "weight"; raw: string; kg: number; order: number }
	| {
			kind: "date"
			raw: string
			prefix: string
			sign: "+" | "-"
			/** Undefined when only month/day are known (e.g. recurring birthdays). */
			year: number | undefined
			/** Undefined when the exact month is unknown. */
			month: number | undefined
			/** Undefined when the exact day is unknown. */
			day: number | undefined
			/**
			 * Sort key. Valid Gregorian dates use the astronomical JDN; out-of-bounds
			 * dates (e.g. fictional calendars) fall back to a deterministic tuple
			 * ordinal so they can still be stored, displayed and sorted.
			 */
			order: number
	  }

/**
 * A date that may omit month and/or day. Used both for stored trait values and
 * for computing order ranges.
 */
export type PartialDate = {
	sign: "+" | "-"
	year?: number
	month?: number
	day?: number
}

/**
 * Value carried by date trait filter clauses. The calendar label (`prefix`)
 * is intentionally omitted from filtering. Valid Gregorian dates compare by
 * astronomical JDN; out-of-bounds dates use the same tuple fallback as
 * {@link computeDateOrder}.
 */
export type DateFilterValue = {
	sign: "+" | "-"
	year: number
	month: number
	day: number
}

export const dateFilterValue = z.object({
	sign: z.enum(["+", "-"]),
	year: z.number().int().positive(),
	month: z.number().int().min(1),
	day: z.number().int().min(1),
})

/**
 * Value carried by month-day-only date trait filter clauses. The year is
 * intentionally omitted so the same calendar month/day can be matched
 * regardless of the stored date's year (useful for birthdays and
 * anniversaries). Month/day limits are relaxed to allow fictional calendars.
 */
export type MonthDayFilterValue = {
	month: number
	day: number
}

export const monthDayFilterValue = z.object({
	month: z.number().int().min(1),
	day: z.number().int().min(1),
})

/**
 * A filter clause against a single trait, used in character search.
 * Range operators (`>`, `>=`, `<`, `<=`, `=`) apply only to numeric
 * kinds (`number`, `height`, `weight`); `contains` applies to text kinds;
 * `empty`/`notempty` apply to all kinds. Date traits use dedicated
 * `date*` operators and carry a structured {@link DateFilterValue} or
 * {@link MonthDayFilterValue}.
 */
export type TraitFilter =
	| { traitId: string; op: ">" | ">=" | "<" | "<=" | "="; value: number }
	| {
			traitId: string
			op:
				| "dateAfter"
				| "dateOnOrAfter"
				| "dateBefore"
				| "dateOnOrBefore"
				| "dateOn"
			value: DateFilterValue
	  }
	| { traitId: string; op: "dateMonthDayOn"; value: MonthDayFilterValue }
	| { traitId: string; op: "dateMonthDayToday" }
	| { traitId: string; op: "contains"; value: string }
	| { traitId: string; op: "empty" | "notempty" }

export const traitFilter = z.discriminatedUnion("op", [
	z.object({
		traitId: id,
		op: z.enum([">", ">=", "<", "<=", "="]),
		value: z.number().finite(),
	}),
	z.object({
		traitId: id,
		op: z.enum([
			"dateAfter",
			"dateOnOrAfter",
			"dateBefore",
			"dateOnOrBefore",
			"dateOn",
		]),
		value: dateFilterValue,
	}),
	z.object({
		traitId: id,
		op: z.literal("dateMonthDayOn"),
		value: monthDayFilterValue,
	}),
	z.object({
		traitId: id,
		op: z.literal("dateMonthDayToday"),
	}),
	z.object({
		traitId: id,
		op: z.literal("contains"),
		value: z.string().max(MAX_TRAIT_FILTER_VALUE_LENGTH),
	}),
	z.object({
		traitId: id,
		op: z.enum(["empty", "notempty"]),
	}),
])

export class TraitParseError extends Error {
	constructor(kind: TraitKind, raw: string) {
		super(`invalid ${kind} value: "${raw}"`)
		this.name = "TraitParseError"
	}
}

function parseText(raw: string): Extract<TraitValue, { kind: "text" }> {
	return { kind: "text", raw }
}

function parseMultitext(
	raw: string,
): Extract<TraitValue, { kind: "multitext" }> {
	const values = raw
		.split(",")
		.map((v) => v.trim())
		.filter((v) => v.length > 0)
	return { kind: "multitext", raw, values }
}

function parseNumber(raw: string): Extract<TraitValue, { kind: "number" }> {
	const str = raw.endsWith("+") ? raw.slice(0, -1) : raw
	const order = parseFloat(str)
	if (!Number.isFinite(order) || Number.isNaN(order))
		throw new TraitParseError("number", raw)
	return { kind: "number", raw, order }
}

const HEIGHT_RE = /^(\d+(?:\.\d+)?)(cm|m|km)$/

function parseHeight(raw: string): Extract<TraitValue, { kind: "height" }> {
	const match = raw.match(HEIGHT_RE)
	if (!match || match[1] === undefined || match[2] === undefined)
		throw new TraitParseError("height", raw)
	const value = parseFloat(match[1])
	const unitRaw = match[2]
	if (unitRaw !== "cm" && unitRaw !== "m" && unitRaw !== "km")
		throw new TraitParseError("height", raw)
	const unit: "cm" | "m" | "km" = unitRaw
	const cm =
		unit === "cm" ? value : unit === "m" ? value * 100 : value * 100_000
	return { kind: "height", raw, cm, order: cm }
}

const WEIGHT_RE = /^(\d+(?:\.\d+)?)(kg|t)$/

function parseWeight(raw: string): Extract<TraitValue, { kind: "weight" }> {
	const match = raw.match(WEIGHT_RE)
	if (!match || match[1] === undefined || match[2] === undefined)
		throw new TraitParseError("weight", raw)
	const value = parseFloat(match[1])
	const unitRaw = match[2]
	if (unitRaw !== "kg" && unitRaw !== "t")
		throw new TraitParseError("weight", raw)
	const unit: "kg" | "t" = unitRaw
	const kg = unit === "kg" ? value : value * 1000
	return { kind: "weight", raw, kg, order: kg }
}

function isPositiveInt(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		Number.isInteger(value) &&
		value > 0
	)
}

function isLeapYear(astronomicalYear: number): boolean {
	return (
		astronomicalYear % 4 === 0 &&
		(astronomicalYear % 100 !== 0 || astronomicalYear % 400 === 0)
	)
}

function daysInMonth(astronomicalYear: number, month: number): number {
	if (month === 2) return isLeapYear(astronomicalYear) ? 29 : 28
	if (month === 4 || month === 6 || month === 9 || month === 11) return 30
	return 31
}

function isValidGregorianDate(
	astronomicalYear: number,
	month: number,
	day: number,
): boolean {
	return (
		month >= 1 && month <= 12 && day <= daysInMonth(astronomicalYear, month)
	)
}

/**
 * Deterministic order for dates that do not fit the Gregorian calendar.
 * Shifted away from the JDN range so fictional dates never interleave with
 * valid Gregorian dates.
 */
function fictionalDateOrder(
	astronomicalYear: number,
	month: number,
	day: number,
): number {
	const ordinal = astronomicalYear * 1_000_000 + month * 10_000 + day
	// JDN occupies roughly [-1_000_000, +5_000_000] for reasonable years.
	// Shift positive astronomical years upward and non-positive downward.
	return astronomicalYear > 0 ? ordinal + 10_000_000 : ordinal - 10_000_000
}

function gregorianJdn(
	astronomicalYear: number,
	month: number,
	day: number,
): number {
	const a = Math.floor((14 - month) / 12)
	const y = astronomicalYear + 4800 - a
	const m = month + 12 * a - 3
	return (
		day +
		Math.floor((153 * m + 2) / 5) +
		365 * y +
		Math.floor(y / 4) -
		Math.floor(y / 100) +
		Math.floor(y / 400) -
		32045
	)
}

/**
 * Convert a signed year to the astronomical year used by the Gregorian JDN
 * formula. Year 1 BC is astronomical year 0; year 2 BC is -1, etc.
 */
function toAstronomicalYear(sign: "+" | "-", year: number): number {
	return sign === "+" ? year : 1 - year
}

/**
 * Fill missing month/day with their earliest possible value so partial dates
 * still produce a deterministic sort key. When the year is unknown we use
 * astronomical year 4 (a leap year) so that February 29th can still be sorted.
 */
function earliestCalendarDate(date: PartialDate): {
	astronomicalYear: number
	month: number
	day: number
} {
	const astronomicalYear =
		date.year === undefined ? 4 : toAstronomicalYear(date.sign, date.year)
	return {
		astronomicalYear,
		month: date.month ?? 1,
		day: date.day ?? 1,
	}
}

/**
 * Compute the order for a date value. Valid Gregorian dates use the
 * astronomical JDN; out-of-bounds dates use a deterministic fallback ordinal
 * so fictional calendars can still be stored and sorted. For partial dates the
 * missing month/day are treated as 1 so the value sorts at the start of the
 * known period.
 */
export function computeDateOrder(value: PartialDate): number {
	const { astronomicalYear, month, day } = earliestCalendarDate(value)
	if (isValidGregorianDate(astronomicalYear, month, day)) {
		return gregorianJdn(astronomicalYear, month, day)
	}
	return fictionalDateOrder(astronomicalYear, month, day)
}

/**
 * Order range spanned by a possibly partial date. Used by date trait filters
 * so that e.g. "2000" matches the whole year and "2000-06" matches the
 * whole month. When the year is unknown the upper bound is +Infinity because
 * the date could fall in any year. Out-of-bounds dates collapse to a single
 * point because we do not know the rules of the fictional calendar.
 */
export function computeDateOrderRange(date: PartialDate): {
	min: number
	max: number
} {
	const { astronomicalYear, month, day } = earliestCalendarDate(date)
	if (!isValidGregorianDate(astronomicalYear, month, day)) {
		const order = fictionalDateOrder(astronomicalYear, month, day)
		return { min: order, max: order }
	}
	const min = gregorianJdn(astronomicalYear, month, day)
	if (date.year === undefined) {
		return { min, max: Number.POSITIVE_INFINITY }
	}
	const maxMonth = date.month ?? 12
	const maxDay = date.day ?? daysInMonth(astronomicalYear, maxMonth)
	const max = gregorianJdn(astronomicalYear, maxMonth, maxDay)
	return { min, max }
}

function parseOptionalPositiveInt(value: unknown): number | undefined {
	if (value === undefined) return undefined
	if (!isPositiveInt(value)) return undefined
	return value
}

function parseDate(raw: string): Extract<TraitValue, { kind: "date" }> {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		throw new TraitParseError("date", raw)
	}
	if (parsed === null || typeof parsed !== "object")
		throw new TraitParseError("date", raw)
	const obj = parsed as Record<string, unknown>
	const prefix = obj.p
	const sign = obj.s
	const year = parseOptionalPositiveInt(obj.y)
	const month = parseOptionalPositiveInt(obj.m)
	const day = parseOptionalPositiveInt(obj.d)
	if (prefix !== undefined && typeof prefix !== "string")
		throw new TraitParseError("date", raw)
	if (sign !== "+" && sign !== "-") throw new TraitParseError("date", raw)
	// If a date component is supplied it must be a positive integer.
	if (obj.y !== undefined && year === undefined)
		throw new TraitParseError("date", raw)
	if (obj.m !== undefined && month === undefined)
		throw new TraitParseError("date", raw)
	if (obj.d !== undefined && day === undefined)
		throw new TraitParseError("date", raw)
	// Month/day are intentionally not validated against the Gregorian calendar so
	// that fictional calendars (e.g. a February with 30 days) can be stored and
	// displayed. Ordering falls back to a deterministic tuple ordinal for
	// out-of-bounds dates. A date with only sign/prefix is allowed so the UI
	// can keep the editor row alive while the user is entering values.
	const order = computeDateOrder({ sign, year, month, day })
	return {
		kind: "date",
		raw,
		prefix: (prefix as string | undefined) ?? "",
		sign,
		year,
		month,
		day,
		order,
	}
}

/**
 * Parse a raw string value according to its trait's kind. Returns a typed
 * {@link TraitValue} with structural data for sorting and filtering.
 *
 * @throws {TraitParseError} when the raw string does not match the expected
 * format for the given kind.
 *
 * @example
 * parseTraitValue("height", "170cm") // { kind: "height", raw: "170cm", cm: 170, order: 170 }
 * parseTraitValue("number", "18+")   // { kind: "number", raw: "18+", order: 18 }
 */
export function parseTraitValue(kind: TraitKind, raw: string): TraitValue {
	switch (kind) {
		case "text":
			return parseText(raw)
		case "multitext":
			return parseMultitext(raw)
		case "number":
			return parseNumber(raw)
		case "height":
			return parseHeight(raw)
		case "weight":
			return parseWeight(raw)
		case "date":
			return parseDate(raw)
	}
}
