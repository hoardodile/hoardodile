import type { PdfAnchor } from "./shared"

/**
 * Validate the raw anchor payload the host forwarded. The SDK calls this
 * at the boundary; returning `undefined` drops the jump silently, so
 * malformed or stale anchors never reach the viewer.
 */
export function decodeAnchor(data: unknown): PdfAnchor | undefined {
	if (typeof data !== "object" || data === null) return undefined
	const pageIndex = (data as { readonly pageIndex?: unknown }).pageIndex
	if (
		typeof pageIndex !== "number" ||
		!Number.isInteger(pageIndex) ||
		pageIndex < 0
	) {
		return undefined
	}
	return { pageIndex }
}
