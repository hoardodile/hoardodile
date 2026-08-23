import type { PluginSchema } from "@hoardodile/sdk-types"

export type PdfFile = {
	readonly filename: string
	readonly sizeBytes: number
}

/**
 * Metadata shown on cards and in the detail header. `pageCount` is a
 * best-effort scan (PDFs with compressed object streams undercount);
 * the viewer always shows the exact page count once loaded.
 */
export type PdfSourceMeta = {
	readonly files: readonly string[]
	readonly pageCount: number | undefined
	readonly sizeBytes: number
	readonly version: string | undefined
}

/** Anchor payload carried by host messages: a 0-based page index. */
export type PdfAnchor = {
	readonly pageIndex: number
}

/**
 * Declared once and shared between the server definition (`definePlugin`)
 * and the web API (`definePluginAPI`) so both sides stay in sync.
 */
export interface PdfSchema extends PluginSchema {
	readonly file: PdfFile
	readonly sourceMeta: PdfSourceMeta
	readonly anchor: PdfAnchor
}
