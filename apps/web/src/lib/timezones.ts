export type TimeZoneOption = {
	readonly value: string
	readonly label: string
}

type TimeZoneEntry = TimeZoneOption & {
	readonly offsetMinutes: number
}

/** Current GMT offset label for an IANA zone (e.g. `GMT+08:00`, `GMT`). */
function getGmtOffsetLabel(timeZone: string): string {
	const parts = new Intl.DateTimeFormat("en", {
		timeZone,
		timeZoneName: "longOffset",
	}).formatToParts()
	return parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT"
}

function parseOffsetMinutes(gmtLabel: string): number {
	const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(gmtLabel)
	if (!match) return 0
	const minutes = Number(match[2]) * 60 + Number(match[3])
	return match[1] === "-" ? -minutes : minutes
}

let cachedTimeZoneOptions: readonly TimeZoneOption[] | undefined

/**
 * Full list of IANA time zones from `Intl.supportedValuesOf`, labeled with
 * their current GMT offset (e.g. `GMT+08:00 Asia/Shanghai`) and sorted by
 * offset, then by name. Computed once and cached at module level.
 */
export function getTimeZoneOptions(): readonly TimeZoneOption[] {
	if (cachedTimeZoneOptions) return cachedTimeZoneOptions
	const entries: TimeZoneEntry[] = Intl.supportedValuesOf("timeZone").map(
		(timeZone) => {
			const offset = getGmtOffsetLabel(timeZone)
			return {
				value: timeZone,
				label: `${offset} ${timeZone}`,
				offsetMinutes: parseOffsetMinutes(offset),
			}
		},
	)
	entries.sort(
		(a, b) =>
			a.offsetMinutes - b.offsetMinutes || a.value.localeCompare(b.value),
	)
	cachedTimeZoneOptions = entries.map(({ value, label }) => ({ value, label }))
	return cachedTimeZoneOptions
}
