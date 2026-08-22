import { isValidIanaTimeZone } from "@hoardodile/schemas"
import dayjs from "src/lib/dayjs.ts"

/**
 * Format a Unix-millisecond timestamp as `YYYY-MM-DD HH:mm:ss` in the given
 * IANA zone (defaults to UTC). Used as the server fallback display name when a
 * client creates a resource or character without supplying one.
 */
export function formatTimestamp(ts: number, timeZone = "UTC"): string {
	const zone = isValidIanaTimeZone(timeZone) ? timeZone : "UTC"
	return dayjs(ts).tz(zone).format("YYYY-MM-DD HH:mm:ss")
}
