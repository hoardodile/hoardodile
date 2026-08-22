/**
 * Parse RFC 5987 `filename*` (preferred) or quoted `filename` from a
 * Content-Disposition value string.
 */
export function parseFilenameFromContentDisposition(
	header: string | null,
): string | undefined {
	if (header === null || header.length === 0) return undefined

	const star = /filename\*=(?:UTF-8''|utf-8'')([^;\s]+)/i.exec(header)
	if (star?.[1] !== undefined) {
		try {
			return decodeURIComponent(star[1].trim())
		} catch {
			// fall through
		}
	}

	const quoted = /filename="((?:\\.|[^"])*)"/i.exec(header)
	if (quoted?.[1] !== undefined) {
		return quoted[1].replace(/\\(.)/g, "$1")
	}

	return undefined
}
