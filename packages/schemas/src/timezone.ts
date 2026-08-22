/** User preference sentinel for the browser or server OS local time zone. */
export const LOCAL_TIME_ZONE_SENTINEL = "local"

/** Returns whether `timeZone` is a valid IANA zone name accepted by `Intl`. */
export function isValidIanaTimeZone(timeZone: string): boolean {
	try {
		Intl.DateTimeFormat(undefined, { timeZone })
		return true
	} catch {
		return false
	}
}
