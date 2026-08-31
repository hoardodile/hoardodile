import prettyBytes from "pretty-bytes"

/**
 * Format a non-negative byte count as a short human-readable string
 * via {@link prettyBytes} with binary conversion (base 1024) and JEDEC
 * labels (`4.5 KB`, `1.2 MB`, `930 GB`) — IEC `KiB`/`MiB`/`GiB` mapped
 * to `KB`/`MB`/`GB`. Matches how Windows and most disk tools report
 * sizes, without switching to decimal (base 1000) units.
 *
 * Returns the empty string for `undefined` so callers can splat the value
 * into a template without conditional checks. Negative or non-finite
 * inputs are clamped to `0 B`.
 */
export function formatBytes(bytes: number | undefined): string {
	if (bytes === undefined) return ""
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
	return prettyBytes(bytes, { binary: true }).replaceAll("iB", "B")
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
