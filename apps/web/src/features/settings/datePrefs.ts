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

export function formatDateTime(
	ts: number,
	dateFormat: string,
	timeZone: string,
): string {
	return dayjsFor(ts, timeZone).format(dateFormat)
}

export function formatDate(
	ts: number,
	dateFormat: string,
	timeZone: string,
): string {
	const dateOnly = dateFormat.split(" ")[0] ?? dateFormat
	return dayjsFor(ts, timeZone).format(dateOnly)
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
