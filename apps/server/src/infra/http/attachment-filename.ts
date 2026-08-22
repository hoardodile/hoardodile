/**
 * Sanitise user-visible names for zip entries and Content-Disposition basenames.
 * Returns `undefined` when nothing usable remains (caller falls back to id).
 */
function stripAsciiControls(raw: string): string {
	let out = ""
	for (const ch of raw) {
		const c = ch.codePointAt(0) ?? 0
		if (c < 0x20 || c === 0x7f) continue
		out += ch
	}
	return out
}

function sanitizeResourceBasename(raw: string): string | undefined {
	let s = stripAsciiControls(raw)
	s = s.replace(/[/\\:*?"<>|]/g, "_")
	s = s.trim().replace(/^[\s.]+|[\s.]+$/g, "")
	if (s.length === 0) return undefined
	const max = 120
	if (s.length > max) s = s.slice(0, max).replace(/[\s.]+$/, "")
	return s.length > 0 ? s : undefined
}

/**
 * `filename*=UTF-8''...` for Unicode. Modern clients prefer RFC 5987.
 */
export function buildAttachmentContentDisposition(args: {
	readonly utf8Filename: string
}): string {
	return `attachment; filename*=UTF-8''${encodeURIComponent(args.utf8Filename)}`
}

function resourceDownloadUtf8Name(
	resourceId: string,
	resourceName: string,
	extensionWithDot: string,
): string {
	const base = sanitizeResourceBasename(resourceName)
	const stem = base !== undefined && base.length > 0 ? base : resourceId
	return `${stem}${extensionWithDot}`
}

export function resourceDownloadDisposition(
	resourceId: string,
	resourceName: string,
	extensionWithDot: string,
): string {
	const utf8 = resourceDownloadUtf8Name(
		resourceId,
		resourceName,
		extensionWithDot,
	)
	return buildAttachmentContentDisposition({ utf8Filename: utf8 })
}

const MAX_BULK_PACK_FOLDER_LEN = 200

/**
 * Top-level zip folder: `{n}-{sanitizedName}` (falls back to id). The numeric
 * prefix guarantees uniqueness among peers even when display names collide.
 */
export function bulkPackFolderName(
	oneBasedIndex: number,
	resourceId: string,
	displayName: string,
): string {
	const stem = sanitizeResourceBasename(displayName) ?? resourceId
	let tail = stem
	if (tail.length > 180)
		tail = tail.slice(0, 180).replace(/[\s.]+$/, "") || resourceId
	const prefix = `${oneBasedIndex}-`
	let out = `${prefix}${tail}`
	if (out.length > MAX_BULK_PACK_FOLDER_LEN) {
		out = out.slice(0, MAX_BULK_PACK_FOLDER_LEN).replace(/[\s._-]+$/, "")
	}
	if (out.length <= prefix.length) {
		out = `${prefix}${resourceId}`.slice(0, MAX_BULK_PACK_FOLDER_LEN)
	}
	return out
}
