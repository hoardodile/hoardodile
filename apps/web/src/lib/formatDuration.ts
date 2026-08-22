const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

/**
 * Format a duration in milliseconds into a short human-readable string.
 *
 * - Less than 1 minute: "Xs"
 * - Less than 1 hour: "Xm"
 * - Less than 1 day: "Xh Ym"
 * - 1 day or more: "Xd Xh"
 */
export function formatDurationMs(ms: number): string {
	if (ms <= 0) return "0s"

	const days = Math.floor(ms / MS_PER_DAY)
	const hours = Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR)
	const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE)
	const seconds = Math.floor((ms % MS_PER_MINUTE) / 1_000)

	if (days > 0) {
		if (hours > 0) return `${days}d ${hours}h`
		return `${days}d`
	}

	if (hours > 0) {
		if (minutes > 0) return `${hours}h ${minutes}m`
		return `${hours}h`
	}

	if (minutes > 0) return `${minutes}m`

	return `${seconds}s`
}

/**
 * Format a duration in milliseconds as a media clock — `m:ss`, or
 * `h:mm:ss` past the hour. Used by the plugin card templates
 * (`{{duration(...)}}`) and the card's inline audio player, so both
 * read the same way.
 */
export function formatClockDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return ""
	const totalSeconds = Math.floor(ms / 1000)
	const hours = Math.floor(totalSeconds / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const seconds = totalSeconds % 60
	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
	}
	return `${minutes}:${String(seconds).padStart(2, "0")}`
}
