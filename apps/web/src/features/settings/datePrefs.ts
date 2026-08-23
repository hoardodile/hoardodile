import { LOCAL_TIME_ZONE_SENTINEL } from "@hoardodile/schemas/timezone"
import { useMemo, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"
import { useStringPrefSync } from "@/hooks/usePrefSync"
import type { Translate } from "@/i18n"
import { prefKeys } from "@/lib/keys"
import {
	dayjsFor,
	getBrowserTimeZone,
	normalizeTimeZonePref,
	resolveBrowserTimeZone,
	resolveTimeZone,
	subscribeBrowserTimeZone,
} from "@/lib/timezone"

export const DATE_FORMAT_PRESETS = [
	{ value: "YYYY-MM-DD HH:mm:ss", labelKey: "dateTime.format.ymdDash" },
	{ value: "YYYY/MM/DD HH:mm:ss", labelKey: "dateTime.format.ymdSlash" },
	{ value: "DD/MM/YYYY HH:mm:ss", labelKey: "dateTime.format.dmySlash" },
	{ value: "MM/DD/YYYY HH:mm:ss", labelKey: "dateTime.format.mdySlash" },
] as const

export const DEFAULT_DATE_FORMAT = DATE_FORMAT_PRESETS[0].value

export const DEFAULT_TIME_ZONE = LOCAL_TIME_ZONE_SENTINEL

export type DateFormatPreset = (typeof DATE_FORMAT_PRESETS)[number]["value"]

export type DateFormatter = {
	readonly formatDateTime: (ts: number) => string
	readonly formatDate: (ts: number) => string
	readonly formatDateTrait: (parsed: {
		readonly prefix: string
		readonly sign: "+" | "-"
		readonly year: number | undefined
		readonly month: number | undefined
		readonly day: number | undefined
	}) => string
}

export function useDatePrefs() {
	const [dateFormat, setDateFormat] = useStringPrefSync(
		prefKeys.dateFormat,
		DEFAULT_DATE_FORMAT,
	)
	const [timeZone, setTimeZone] = useStringPrefSync(
		prefKeys.timeZone,
		DEFAULT_TIME_ZONE,
	)
	return {
		dateFormat,
		setDateFormat,
		timeZone: normalizeTimeZonePref(timeZone),
		setTimeZone,
	}
}

/** IANA zone for API calls; resolves `"local"` to the browser time zone. */
export function useResolvedTimeZone(): string {
	const { timeZone } = useDatePrefs()
	const browserZone = useSyncExternalStore(
		subscribeBrowserTimeZone,
		getBrowserTimeZone,
		getBrowserTimeZone,
	)
	return useMemo(
		() => resolveTimeZone(timeZone, browserZone),
		[timeZone, browserZone],
	)
}

/** Raw pref plus resolved IANA for usage stats (pref for calendar math, resolved for cache deps). */
export function useUsageTimeZones(): {
	readonly timeZonePref: string
	readonly resolvedTimeZone: string
} {
	const { timeZone } = useDatePrefs()
	const resolvedTimeZone = useResolvedTimeZone()
	return { timeZonePref: timeZone, resolvedTimeZone }
}

export { dayjsFor, getBrowserTimeZone, resolveBrowserTimeZone }

/** Date separators that may be dropped together with the year token. */
const DATE_SEPARATORS = ["-", "/", "."] as const

/**
 * The date format with the year token and one adjacent separator removed,
 * for dates in the current calendar year. E.g. "YYYY-MM-DD HH:mm:ss" →
 * "MM-DD HH:mm:ss", "DD/MM/YYYY HH:mm:ss" → "DD/MM HH:mm:ss". Formats
 * without a year token (or with nothing left once the year is gone) are
 * returned unchanged.
 */
export function yearlessDatePart(dateFormat: string): string {
	const match = /(YYYY|YY)/.exec(dateFormat)
	if (match === null) return dateFormat
	const start = match.index
	const tokenLength = match[0].length
	const after = dateFormat[start + tokenLength]
	const before = start > 0 ? dateFormat[start - 1] : undefined

	let removedStart = start
	let removedLength = tokenLength
	if (after !== undefined && isDateSeparator(after)) {
		// The token starts the date part: "YYYY-MM-DD" → "MM-DD".
		removedLength = tokenLength + 1
	} else if (before !== undefined && isDateSeparator(before)) {
		// The token ends the date part: "DD/MM/YYYY" → "DD/MM".
		removedStart = start - 1
		removedLength = tokenLength + 1
	}
	const withoutYear =
		dateFormat.slice(0, removedStart) +
		dateFormat.slice(removedStart + removedLength)
	const result = withoutYear.trim()
	// A format that reduces to only separators shows nothing useful — keep
	// the year rather than rendering an empty date.
	return result.length > 0 ? result : dateFormat
}

function isDateSeparator(char: string): boolean {
	return (DATE_SEPARATORS as readonly string[]).includes(char)
}

function formatTimestamp(
	ts: number,
	dateFormat: string,
	timeZone: string,
): string {
	const d = dayjsFor(ts, timeZone)
	const currentYear = dayjsFor(Date.now(), timeZone).year()
	return d.format(
		d.year() === currentYear ? yearlessDatePart(dateFormat) : dateFormat,
	)
}

export function formatDateTime(
	ts: number,
	dateFormat: string,
	timeZone: string,
): string {
	return formatTimestamp(ts, dateFormat, timeZone)
}

export function formatDate(
	ts: number,
	dateFormat: string,
	timeZone: string,
): string {
	const dateOnly = dateFormat.split(" ")[0] ?? dateFormat
	return formatTimestamp(ts, dateOnly, timeZone)
}

function stripNumericLeadingZeros(value: string): string {
	// Remove leading zeros from each numeric component while preserving
	// multi-digit numbers and separators.
	return value.replace(/\b0+(?=\d)/g, "")
}

function formatPartialDate(
	year: number | undefined,
	month: number | undefined,
	day: number | undefined,
): string {
	// Date traits render in a fixed Y-M-D form. Missing components are shown as
	// "?" so users can tell which part is unknown. Values are not passed through
	// Gregorian date math, keeping fictional-calendar values (e.g. month 13, February 30)
	// from being rolled over.
	if (year === undefined && month === undefined && day === undefined) {
		return ""
	}
	const y = year === undefined ? "?" : String(year)
	const m = month === undefined ? "?" : String(month)
	const d = day === undefined ? "?" : String(day)
	return stripNumericLeadingZeros(`${y}-${m}-${d}`)
}

export function formatDateTrait(
	parsed: {
		readonly prefix: string
		readonly sign: "+" | "-"
		readonly year: number | undefined
		readonly month: number | undefined
		readonly day: number | undefined
	},
	_dateFormat: string,
	t: Translate,
): string {
	const dateLabel = formatPartialDate(parsed.year, parsed.month, parsed.day)
	const signLabel = parsed.sign === "+" ? "" : t("traits.values.date.before")
	const parts = [parsed.prefix.trim(), signLabel, dateLabel].filter(
		(part) => part.length > 0,
	)
	return parts.join(" ")
}

export function useDateFormatter(): DateFormatter {
	const { dateFormat, timeZone } = useDatePrefs()
	const { t } = useTranslation()
	return useMemo(
		() => ({
			formatDateTime: (ts: number) => formatDateTime(ts, dateFormat, timeZone),
			formatDate: (ts: number) => formatDate(ts, dateFormat, timeZone),
			formatDateTrait: (parsed) => formatDateTrait(parsed, dateFormat, t),
		}),
		[dateFormat, timeZone, t],
	)
}
