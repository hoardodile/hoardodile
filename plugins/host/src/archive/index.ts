/**
 * Archive runtime internal to the host: zip reading over random-access
 * sources, `outer!inner` virtual-path resolution, whole-archive
 * extraction through 7-Zip, and zip packing. This barrel only
 * re-exports what the host itself consumes — the public host surface
 * (`../index.ts`) picks its own much smaller set.
 *
 * ── Engine matrix ────────────────────────────────────────────────────
 *
 * Two engines, two jobs:
 *   - **yauzl** is the zip *random-access* engine: central-directory
 *     listing, byte-range entry streams, ZIP64. It cannot read other
 *     formats and is the only engine that can — the read path
 *     (nested addressing, thumbnails, source view) is inseparable from
 *     it. It also serves as the no-7-Zip fallback for zip extraction.
 *   - **7-Zip** is the *whole-archive* engine: `l -slt -ba` listing and
 *     `x` extraction for every supported format. It cannot express
 *     random access (no entry offsets, no byte ranges), so listing
 *     through it is a whole-file operation.
 *
 * Capability matrix (list = file listing, extract = materialize to a
 * directory, address = `outer!inner` single-entry reads):
 *
 *   format   list        extract     address     notes
 *   zip      yauzl       7-Zip       virtual     virtual addressing reads
 *                                                 the CD, never materializes
 *   tar      7-Zip       7-Zip       materialized extracted files are
 *   7z       "           "           "           served from disk via the
 *   rar      "           "           "           manifest whitelist
 *   xz       "           "           (none)      whole-archive only
 *   gzip     7-Zip       7-Zip       (none)      lists as its single
 *                                                 decompressed stream
 *                                                 (e.g. `t.tar`); never
 *                                                 addressable
 *
 *   Degradation without the optional `@hoardodile/7z-bin` binary: zip
 *   keeps full functionality (yauzl everywhere, streaming extraction
 *   with per-byte budget counting); every non-zip list/extract rejects
 *   with "7-Zip is not installed".
 *
 *   Budget semantics differ by engine: with 7-Zip the listing
 *   pre-checks sizes and the extracted tree is re-verified afterwards
 *   (sizes are advisory until measured); the yauzl streaming fallback
 *   counts bytes mid-stream, which also catches lying headers. Both map
 *   to `resource.archive_too_large`.
 *
 *   Encrypted archives reject with different kinds depending on when
 *   the encryption is seen: the 7-Zip listing pre-check reports
 *   `resource.archive_invalid_entry`, the yauzl entry-stream open
 *   reports `resource.archive_open_failed`.
 *
 * Legacy zip entry names (no UTF-8 name flag) decode as codepage 437
 * (`-mcp=437`) on the 7-Zip path; the switch is applied automatically
 * after sniffing, so callers never branch on format.
 */

export type {
	ExtractArchiveOptions,
	ZipExtractReport,
	ZipExtractReporter,
} from "./extract.ts"
export { assertExtractedTree, extractArchiveInto } from "./extract.ts"
export type {
	ArchiveExtractor,
	ExtractedEntry,
	ExtractionResult,
	ExtractProgress,
} from "./extract-archive.ts"
export {
	createArchiveExtractor,
	EXTRACT_INDEX_VERSION,
	PROBE_HEADER_BYTES,
	sanitizeExtractPath,
} from "./extract-archive.ts"
export type {
	ContainerFormat,
	SNIFF_WINDOW_BYTES,
} from "./format.ts"
export { sniffContainerFormat } from "./format.ts"
export {
	listArchiveEntries,
	listingBudgetExceeded,
	validateArchiveBudget,
} from "./listing.ts"
export { materializeFile } from "./materialize.ts"
export type {
	NestedCdCache,
	NestedCdCacheOptions,
} from "./nested-cd-cache.ts"
export { createNestedCdCache } from "./nested-cd-cache.ts"
export type {
	ArchiveEntry,
	NestedResolver,
	OpenableArchiveEntry,
	OuterEntrySource,
	PathResolution,
} from "./nested-entry.ts"
export {
	createNestedResolver,
	createOuterArchiveSource,
	splitVirtualPath,
	VIRTUAL_PATH_SEPARATOR,
} from "./nested-entry.ts"
export type { ZipStreamEntry } from "./pack.ts"
export { streamStoredZip } from "./pack.ts"
export type { ArchiveSource, ZipEntry } from "./zip-entries.ts"
export {
	createFileArchiveSource,
	listZipEntries,
	listZipEntriesFromSource,
	normalizeZipError,
	openZipEntryStream,
	readFileRange,
	readZipRange,
	streamRange,
} from "./zip-entries.ts"
