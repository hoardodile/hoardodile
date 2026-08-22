import {
	isValidIanaTimeZone,
	LOCAL_TIME_ZONE_SENTINEL,
} from "@hoardodile/schemas/timezone"
import dayjs from "@/lib/dayjs"

type BrowserZoneListener = () => void

function readBrowserTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone
}

let cachedBrowserZone = readBrowserTimeZone()
const browserZoneListeners = new Set<BrowserZoneListener>()

function notifyBrowserTimeZoneListeners(): void {
	for (const listener of browserZoneListeners) {
		listener()
	}
}

/** Re-read the browser IANA zone and notify subscribers when it changes. */
export function syncBrowserTimeZone(): void {
	const next = readBrowserTimeZone()
	if (next === cachedBrowserZone) return
	cachedBrowserZone = next
	notifyBrowserTimeZoneListeners()
}

/** Browser IANA time zone from `Intl` (e.g. `Asia/Shanghai`). */
export function getBrowserTimeZone(): string {
	return cachedBrowserZone
}

export function subscribeBrowserTimeZone(
	listener: BrowserZoneListener,
): () => void {
	browserZoneListeners.add(listener)
	return () => {
		browserZoneListeners.delete(listener)
	}
}

/** Calendar month (1–12) and day (1–31) for an instant in a time-zone pref. */
export function getCalendarMonthDay(
	nowMs: number,
	timeZonePref: string,
): { readonly month: number; readonly day: number } {
	const today = dayjsFor(nowMs, timeZonePref)
	return { month: today.month() + 1, day: today.date() }
}

/** Format an instant as `YYYY-MM-DD` in a time-zone pref. */
export function formatCalendarDay(nowMs: number, timeZonePref: string): string {
	return dayjsFor(nowMs, timeZonePref).format("YYYY-MM-DD")
}

if (typeof document !== "undefined") {
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") {
			syncBrowserTimeZone()
		}
	})
}

if (typeof window !== "undefined") {
	window.addEventListener("focus", syncBrowserTimeZone)
	const BROWSER_TIME_ZONE_POLL_MS = 5 * 60 * 1000
	setInterval(() => {
		if (document.visibilityState === "visible") {
			syncBrowserTimeZone()
		}
	}, BROWSER_TIME_ZONE_POLL_MS)
}

/** Normalize a stored time-zone pref; invalid IANA values fall back to `"local"`. */
export function normalizeTimeZonePref(pref: string): string {
	if (pref === LOCAL_TIME_ZONE_SENTINEL || pref.length === 0) {
		return LOCAL_TIME_ZONE_SENTINEL
	}
	if (isValidIanaTimeZone(pref)) {
		return pref
	}
	return LOCAL_TIME_ZONE_SENTINEL
}

/**
 * Resolve a stored time-zone preference to an IANA zone name suitable for
 * API calls and server-side calendar boundaries.
 *
 * When `pref` is `"local"` or empty, returns `localZone` when provided, else
 * `"UTC"` as a deterministic fallback.
 */
export function resolveTimeZone(pref: string, localZone?: string): string {
	if (pref === LOCAL_TIME_ZONE_SENTINEL || pref.length === 0) {
		return localZone ?? "UTC"
	}
	return pref
}

/** Resolve a stored pref (including `"local"`) to an IANA zone for API calls. */
export function resolveBrowserTimeZone(pref: string): string {
	return resolveTimeZone(normalizeTimeZonePref(pref), getBrowserTimeZone())
}

/** Format a timestamp in a stored time-zone pref (`"local"` or IANA). */
export function dayjsFor(ts: number, timeZonePref: string): dayjs.Dayjs {
	return dayjs(ts).tz(resolveBrowserTimeZone(timeZonePref))
}
