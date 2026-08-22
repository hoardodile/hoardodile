import { invalid } from "../errors.ts"
import { listSevenZipEntries, resolveSevenZipPath } from "./7z.ts"
import { SNIFF_WINDOW_BYTES, sniffContainerFormat } from "./format.ts"
import type { ArchiveEntry } from "./nested-entry.ts"
import { listZipEntries, readFileRange } from "./zip-entries.ts"

/**
 * Cross-engine archive listing and budget validation. Zip lists through
 * yauzl, tar/7z/rar/xz/gzip through the 7-Zip binary; the engine choice
 * (and the zip-only legacy-cp437 name decoding, handled inside the 7-Zip
 * wrapper) lives here so callers never branch on format.
 */

/**
 * List the file entries of an on-disk archive across engines: zip lists
 * through yauzl, tar/7z/rar/xz/gzip through the 7-Zip binary (gzip
 * reports its single decompressed stream).
 *
 * @throws DomainError `resource.archive_open_failed` when the file is
 *   not a readable archive, or 7-Zip is missing for a non-zip format.
 */
export async function listArchiveEntries(
	archivePath: string,
): Promise<readonly ArchiveEntry[]> {
	const head = await readFileRange(archivePath, 0, SNIFF_WINDOW_BYTES - 1)
	const format = sniffContainerFormat(head)
	if (format === "zip") {
		const records = await listZipEntries(archivePath)
		return records.map((r) => ({ name: r.name, sizeBytes: r.uncompressedSize }))
	}
	if (format === undefined) {
		throw invalid(
			"resource.archive_open_failed",
			"not a supported archive (zip/tar/7z/rar/xz/gzip)",
			{},
		)
	}
	if (resolveSevenZipPath() === undefined) {
		throw invalid(
			"resource.archive_open_failed",
			"7-Zip is not installed — cannot list tar/7z/rar/xz/gzip archives",
			{},
		)
	}
	const entries = await listSevenZipEntries(archivePath)
	return entries
		.filter((e) => !e.folder)
		.map((e) => ({ name: e.name, sizeBytes: e.sizeBytes }))
}

/**
 * Which listing budget is exceeded, or `undefined` when the listing
 * fits. Pure computation — callers decide the error kind and message
 * (the plugin extractor and the whole-archive extractor use different
 * domain kinds), so one budget rule serves both.
 */
export function listingBudgetExceeded(
	entries: readonly { readonly sizeBytes: number }[],
	opts: { readonly maxBytes: number; readonly maxEntries?: number },
):
	| {
			readonly kind: "bytes"
			readonly totalBytes: number
			readonly maxBytes: number
	  }
	| {
			readonly kind: "entries"
			readonly count: number
			readonly maxEntries: number
	  }
	| undefined {
	if (opts.maxEntries !== undefined && entries.length > opts.maxEntries) {
		return {
			kind: "entries",
			count: entries.length,
			maxEntries: opts.maxEntries,
		}
	}
	let totalBytes = 0
	for (const entry of entries) {
		totalBytes += entry.sizeBytes
		if (totalBytes > opts.maxBytes) {
			return {
				kind: "bytes",
				totalBytes,
				maxBytes: opts.maxBytes,
			}
		}
	}
	return undefined
}

/**
 * Validate an on-disk archive's cumulative uncompressed size against
 * `maxBytes` without inflating any entry bytes (metadata-only — the
 * listing never decompresses). Format-agnostic via
 * {@link listArchiveEntries}; unknown content and non-zip formats
 * without the 7-Zip binary are rejected outright.
 *
 * Used at commit time for uploaded archives so every supported format
 * passes the same bomb gate.
 *
 * @throws DomainError `resource.archive_open_failed` when the file is
 *   not a readable archive (or 7-Zip is missing for non-zip formats).
 * @throws DomainError `resource.archive_too_large` when the cumulative
 *   uncompressed size exceeds `maxBytes`.
 */
export async function validateArchiveBudget(
	archivePath: string,
	maxBytes: number,
): Promise<void> {
	const entries = await listArchiveEntries(archivePath)
	const exceeded = listingBudgetExceeded(entries, { maxBytes })
	if (exceeded?.kind === "bytes") {
		throw invalid(
			"resource.archive_too_large",
			`archive uncompressed size exceeds ${maxBytes} bytes`,
			{ maxBytes },
		)
	}
}
