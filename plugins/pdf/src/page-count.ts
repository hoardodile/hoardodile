const MAX_PATTERN = /\/Type\s*\/Page(?!s)/g

/**
 * Cheap page-count estimate from the raw bytes: count `/Type /Page`
 * objects while excluding `/Type /Pages` tree nodes.
 *
 * Best effort by design — the count is zero when the PDF carries its
 * objects in compressed object streams (the objects are then not text,
 * so nothing matches) or when the buffer is truncated. Callers must
 * treat a missing result as "unknown", never as "no pages".
 */
export function countPagesFromBytes(bytes: Uint8Array): number | undefined {
	const text = new TextDecoder("latin1").decode(bytes)
	if (!text.startsWith("%PDF-")) return undefined
	const matches = text.match(MAX_PATTERN)
	return matches === null || matches.length === 0 ? undefined : matches.length
}

/** Header version string from the `%PDF-1.x` line, if present. */
export function pdfVersionFromBytes(bytes: Uint8Array): string | undefined {
	const text = new TextDecoder("latin1").decode(bytes.subarray(0, 64))
	return /%PDF-(\d+\.\d+)/.exec(text)?.[1]
}
