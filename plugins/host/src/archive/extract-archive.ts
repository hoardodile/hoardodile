import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { MediaKind } from "@hoardodile/sdk-types"
import { fileTypeFromName } from "@hoardodile/sdk-types"

import { invalid } from "../errors.ts"
import {
	extractSevenZipInto,
	listSevenZipEntries,
	resolveSevenZipPath,
} from "./7z.ts"
import {
	assertExtractedTree,
	decodeZipNames,
	normalizeExtractedTree,
} from "./extract.ts"
import {
	type ContainerFormat,
	SNIFF_WINDOW_BYTES,
	sniffContainerFormat,
} from "./format.ts"
import { materializeFile } from "./materialize.ts"
import type { NestedCdCache } from "./nested-cd-cache.ts"
import {
	type ArchiveEntry,
	createNestedResolver,
	createOuterArchiveSource,
	type OuterEntrySource,
} from "./nested-entry.ts"
import { streamRange } from "./zip-entries.ts"

/**
 * Header window read before handing bytes to the injected image prober.
 * Shared with the host's sharp-backed probes so both sides feed the same
 * bounded window (JPEG SOF markers live in the first KBs; 256KB covers
 * even EXIF-bloated JPEGs).
 */
export const PROBE_HEADER_BYTES = 256 * 1024

/** Input accepted by the injected image prober (host's sharp probe). */
export type ImageProbeInput = string | Buffer

/** Result of the injected image prober. */
export type ImageProbeResult = {
	readonly width: number
	readonly height: number
	readonly animated: boolean
}

/**
 * Materialize a container entry (zip/tar/7z/rar/xz/gzip) into a cache
 * directory so the browser can serve the inner files over plain URLs.
 * This is the only disk-writing capability of the plugin API; everything
 * else about containers (cover probing, dimensions, hashes) reads
 * through virtual paths without materialization.
 *
 * Extraction is whole-archive through 7-Zip (budgets and paths validated
 * from its listing, then the extracted tree re-verified â€” see
 * `assertExtractedTree`). The manifest below is built from the listing,
 * so entries carry the exact names and sizes 7-Zip reported.
 *
 * Cache layout (per archive):
 *   <cacheDir>/<archiveName>/index.json   â€” completion marker + manifest
 *   <cacheDir>/<archiveName>/<innerPath>  â€” extracted file (subdirs kept)
 *
 * The `index.json` marker is written last and atomically: its presence
 * means extraction completed. A partial or failed run leaves files but no
 * marker, so the next call re-extracts idempotently.
 */

export const EXTRACT_INDEX_VERSION = 1

export type ExtractedEntry = {
	readonly path: string
	readonly sizeBytes: number
	readonly kind: MediaKind
	readonly width?: number
	readonly height?: number
	readonly animated?: boolean
}

export type ExtractionResult = {
	readonly entries: readonly ExtractedEntry[]
}

export type ExtractProgress = {
	/** Entries materialized so far (skipped cached files count too). */
	readonly done: number
	readonly total: number
}

export type ExtractArchiveDeps = {
	/** Read access to the outer container (the resource's entries). */
	readonly outer: OuterEntrySource
	/**
	 * Absolute cache directory for this resource's plugin extractions
	 * (e.g. `<cacheRoot>/resources/<id>/extracted/v<N>/archives`).
	 */
	readonly cacheDir: string
	/** Cumulative uncompressed byte budget for one archive. */
	readonly maxBytes: number
	/** Entry-count budget for one archive. */
	readonly maxEntries: number
	/** Optional image prober (sharp-backed) for per-entry dimensions. */
	readonly probeImage?: (
		source: ImageProbeInput,
		extHint?: string,
	) => Promise<ImageProbeResult | undefined>
	/**
	 * Called as entries are materialized, so a long first extraction can
	 * surface progress to the user.
	 */
	readonly onProgress?: (progress: ExtractProgress) => void
	/** Shared nested-listing cache (see {@link NestedCdCache}). */
	readonly nestedCdCache?: NestedCdCache
}

export type ArchiveExtractor = {
	/**
	 * Materialize (or re-list) the container `archiveName`. Idempotent
	 * and single-flighted per archive name.
	 */
	readonly extract: (archiveName: string) => Promise<ExtractionResult>
	/**
	 * List the container's entries without materializing anything into
	 * the final cache layout. Resolves to `undefined` when `archiveName`
	 * is not a container (or no 7-Zip binary exists for non-zip
	 * formats).
	 */
	readonly list: (
		archiveName: string,
	) => Promise<readonly ArchiveEntry[] | undefined>
}

/** Build a single-flight, idempotent extractor over one outer container. */
export function createArchiveExtractor(
	deps: ExtractArchiveDeps,
): ArchiveExtractor {
	const resolver = createNestedResolver(deps.outer, {
		cdCache: deps.nestedCdCache,
	})
	const inflight = new Map<string, Promise<ExtractionResult>>()

	function extract(archiveName: string): Promise<ExtractionResult> {
		const pending = inflight.get(archiveName)
		if (pending !== undefined) return pending
		const work = extractOnce(archiveName)
		inflight.set(archiveName, work)
		void work.then(
			() => undefined,
			() => undefined,
		)
		return work
	}

	async function extractOnce(archiveName: string): Promise<ExtractionResult> {
		const size = await deps.outer.sizeOf(archiveName)
		if (size === undefined) {
			throw invalid(
				"plugin.container_extract_failed",
				`"${archiveName}" does not exist`,
				{ archiveName },
			)
		}
		const markerPath = join(deps.cacheDir, archiveName, "index.json")
		const existing = await readExistingManifest(markerPath, archiveName)
		if (existing !== undefined) return { entries: existing }
		if (size > 0) {
			const head = await deps.outer.readSlice(
				archiveName,
				0,
				Math.min(size, SNIFF_WINDOW_BYTES),
			)
			const format = sniffContainerFormat(head)
			if (format !== undefined) {
				return extractWithSevenZip(archiveName, size, markerPath, format)
			}
		}
		throw invalid(
			"plugin.container_extract_failed",
			`"${archiveName}" is not a supported archive (zip/tar/7z/rar/xz/gzip)`,
			{ archiveName },
		)
	}

	/**
	 * Whole-archive extraction through 7-Zip: materialize the outer entry
	 * to a temp file (7-Zip needs a real path), validate budgets and
	 * encryption from the listing, extract into the cache dir, then build
	 * the idempotent manifest. Runs for every supported format â€” zip/tar
	 * included, exactly like the 7z/rar/xz branch before them.
	 */
	async function extractWithSevenZip(
		archiveName: string,
		size: number,
		markerPath: string,
		format: ContainerFormat,
	): Promise<ExtractionResult> {
		const source = createOuterArchiveSource(deps.outer, archiveName, size)
		const tempPath = join(
			deps.cacheDir,
			`${archiveName}.7z-partial-${process.pid}-${randomUUID().slice(0, 8)}`,
		)
		await mkdir(deps.cacheDir, { recursive: true })
		try {
			await materializeFile({
				openStream: () => streamRange(source, 0, size - 1),
				target: tempPath,
				expectedSize: size,
			})
			const entries = await listSevenZipEntries(tempPath)
			const files = entries.filter((e) => !e.folder)
			checkExtractionBudgets(archiveName, files, deps.maxBytes, deps.maxEntries)
			if (entries.some((e) => e.encrypted)) {
				throw invalid(
					"plugin.container_extract_failed",
					`archive "${archiveName}" is password-protected â€” encrypted archives are not supported`,
					{ archiveName },
				)
			}
			// 7-Zip's text listing drops invalid-UTF-8 bytes on POSIX, so
			// for zip archives the decoded names come from the archive
			// itself (yauzl): the manifest, the probes and the legacy-name
			// renames below all agree on them.
			const decoded =
				format === "zip"
					? await decodeZipNames(
							tempPath,
							files.map((e) => ({ name: e.name, sizeBytes: e.sizeBytes })),
						)
					: undefined
			const materialized = decoded?.files ?? files
			// Pre-validate every path from the listing â€” 7-Zip itself
			// warns-and-skips unsafe names instead of failing.
			for (const entry of materialized) sanitizeExtractPath(entry.name)
			const root = join(deps.cacheDir, archiveName)
			await mkdir(root, { recursive: true })
			await extractSevenZipInto(tempPath, root)
			// 7-Zip writes legacy zip names verbatim on POSIX and restores
			// mode bits that can strip app access; fix both before the tree
			// is re-walked (symlink scan) or read for the manifest below.
			// The decoded names are the ground truth the legacy rename pass
			// matches against (see `renameLegacyZipNames` in extract.ts).
			await normalizeExtractedTree(root, {
				legacyZipNames: format === "zip",
				expectedNames: decoded?.paths,
			})
			await assertExtractedTree(root, deps.maxBytes)
			deps.onProgress?.({ done: files.length, total: files.length })
			const manifest = await buildManifest(
				archiveName,
				materialized.map((e) => ({ name: e.name, sizeBytes: e.sizeBytes })),
			)
			await writeManifest(markerPath, archiveName, manifest)
			// The manifest now serves listings (and materialized virtual
			// paths); drop the size-keyed listing cache for this archive.
			await rm(join(deps.cacheDir, `${archiveName}.7z-list`), {
				force: true,
			}).catch(() => {})
			await rm(join(deps.cacheDir, `${archiveName}.7z-list.json`), {
				force: true,
			}).catch(() => {})
			return { entries: manifest }
		} finally {
			await rm(tempPath, { force: true }).catch(() => {})
		}
	}

	/** Shared bomb guards for one extraction: entry count and total bytes. */
	function checkExtractionBudgets(
		archiveName: string,
		entries: readonly { readonly sizeBytes: number }[],
		maxBytes: number,
		maxEntries: number,
	): void {
		if (entries.length > maxEntries) {
			throw invalid(
				"plugin.container_extract_failed",
				`archive "${archiveName}" has ${entries.length} entries, exceeding the limit of ${maxEntries}`,
				{ archiveName, entries: entries.length, maxEntries },
			)
		}
		let totalBytes = 0
		for (const entry of entries) totalBytes += entry.sizeBytes
		if (totalBytes > maxBytes) {
			throw invalid(
				"plugin.container_extract_failed",
				`archive "${archiveName}" unpacks to ${totalBytes} bytes, exceeding the limit of ${maxBytes}`,
				{ archiveName, totalBytes, maxBytes },
			)
		}
	}

	async function buildManifest(
		archiveName: string,
		entries: readonly ArchiveEntry[],
	): Promise<readonly ExtractedEntry[]> {
		const manifest: ExtractedEntry[] = []
		for (const entry of entries) {
			const kind = fileTypeFromName(entry.name)?.kind ?? "other"
			const row: MutableExtractedEntry = {
				path: entry.name,
				sizeBytes: entry.sizeBytes,
				kind,
			}
			if (kind === "image" && deps.probeImage !== undefined) {
				const rel = sanitizeExtractPath(entry.name)
				const filePath = join(deps.cacheDir, archiveName, rel)
				const probe = await probeImageHead(
					deps.probeImage,
					filePath,
					entry.name,
				)
				if (probe !== undefined) {
					row.width = probe.width
					row.height = probe.height
					row.animated = probe.animated
				}
			}
			manifest.push(row)
		}
		return manifest
	}

	/**
	 * List the container's entries. Zip lists from the nested resolver
	 * (CD parse, nothing materialized); tar/7z/rar/xz list through the
	 * 7-Zip binary over a size-keyed materialization cache in the cache
	 * dir (7-Zip needs a real path; the bytes are written once per outer
	 * size and reused across hook calls â€” every hook call builds a fresh
	 * API instance, so per-call temp files would re-write the whole
	 * archive each time). Resolves to `undefined` when the entry is not a
	 * container, is gzip (whole-archive single-stream), or the 7-Zip
	 * binary is absent (quiet degradation â€” callers treat it as "not a
	 * container", matching the resolver semantics).
	 */
	async function list(
		archiveName: string,
	): Promise<readonly ArchiveEntry[] | undefined> {
		const size = await deps.outer.sizeOf(archiveName)
		if (size === undefined) return undefined
		// An extracted archive answers from its manifest â€” cheaper than
		// any listing, and the manifest is the source of truth for the
		// materialized virtual paths (see nested-view.ts).
		const markerPath = join(deps.cacheDir, archiveName, "index.json")
		const extracted = await readExistingManifest(markerPath, archiveName)
		if (extracted !== undefined) {
			return extracted.map((e) => ({ name: e.path, sizeBytes: e.sizeBytes }))
		}
		if (size === 0) return undefined
		const head = await deps.outer.readSlice(
			archiveName,
			0,
			Math.min(size, SNIFF_WINDOW_BYTES),
		)
		const format = sniffContainerFormat(head)
		if (format === "zip") {
			const entries = await resolver.list(archiveName)
			if (entries === undefined) return undefined
			return entries.map((e) => ({ name: e.name, sizeBytes: e.sizeBytes }))
		}
		if (
			format === "tar" ||
			format === "7z" ||
			format === "rar" ||
			format === "xz"
		) {
			return listViaSevenZip(archiveName, size)
		}
		return undefined
	}

	/**
	 * Non-zip listing through 7-Zip. The outer entry is materialized once
	 * per size into `<cacheDir>/<archiveName>.7z-list` (keyed by outer
	 * size â€” the source is immutable per version, so a size match means
	 * the cached bytes are the same file) and the parsed listing is
	 * cached next to it. `extractWithSevenZip` removes both files once a
	 * real extraction lands, so the manifest takes over afterwards.
	 */
	async function listViaSevenZip(
		archiveName: string,
		size: number,
	): Promise<readonly ArchiveEntry[] | undefined> {
		if (resolveSevenZipPath() === undefined) return undefined
		await mkdir(deps.cacheDir, { recursive: true })
		const cachePath = join(deps.cacheDir, `${archiveName}.7z-list`)
		const entriesPath = join(deps.cacheDir, `${archiveName}.7z-list.json`)
		const cached = await stat(cachePath).catch(() => undefined)
		if (cached?.size === size) {
			const raw = await readFile(entriesPath, "utf8").catch(() => undefined)
			if (raw !== undefined) {
				try {
					return JSON.parse(raw) as readonly ArchiveEntry[]
				} catch {
					// Corrupt cache â€” fall through and re-materialize.
				}
			}
		}
		try {
			const source = createOuterArchiveSource(deps.outer, archiveName, size)
			await materializeFile({
				openStream: () => streamRange(source, 0, size - 1),
				target: cachePath,
				expectedSize: size,
			})
			const listed = await listSevenZipEntries(cachePath)
			const files = listed
				.filter((e) => !e.folder)
				.map((e) => ({ name: e.name, sizeBytes: e.sizeBytes }))
			await writeFile(entriesPath, JSON.stringify(files))
			return files
		} catch (err) {
			await rm(cachePath, { force: true }).catch(() => {})
			await rm(entriesPath, { force: true }).catch(() => {})
			throw err
		}
	}

	return { extract, list }
}

type MutableExtractedEntry = {
	path: string
	sizeBytes: number
	kind: MediaKind
	width?: number
	height?: number
	animated?: boolean
}

/**
 * Read and validate a manifest written by {@link writeManifest}: version
 * and archive-name must match, otherwise the marker is stale garbage and
 * the caller re-extracts. Shared with the nested-view materialized-path
 * resolution.
 */
export async function readExistingManifest(
	markerPath: string,
	archiveName: string,
): Promise<readonly ExtractedEntry[] | undefined> {
	const raw = await readFile(markerPath, "utf8").catch(() => undefined)
	if (raw === undefined) return undefined
	try {
		const parsed = JSON.parse(raw) as {
			readonly v?: number
			readonly archiveName?: string
			readonly entries?: readonly ExtractedEntry[]
		}
		if (
			parsed.v !== EXTRACT_INDEX_VERSION ||
			parsed.archiveName !== archiveName ||
			!Array.isArray(parsed.entries)
		) {
			return undefined
		}
		return parsed.entries
	} catch {
		return undefined
	}
}

async function writeManifest(
	markerPath: string,
	archiveName: string,
	entries: readonly ExtractedEntry[],
): Promise<void> {
	const payload = JSON.stringify({
		v: EXTRACT_INDEX_VERSION,
		archiveName,
		entries,
	})
	const partial = `${markerPath}.partial-${process.pid}`
	await writeFile(partial, payload)
	await rename(partial, markerPath)
}

/**
 * Normalize an inner entry name to a safe relative path: backslashes
 * become forward slashes, traversal segments and control characters are
 * rejected, and the result must stay inside the extraction root.
 */
export function sanitizeExtractPath(name: string): string {
	const normalized = name.replace(/\\/g, "/")
	if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
		throw invalid(
			"plugin.container_extract_failed",
			`archive entry has an absolute path: "${name}"`,
			{ name },
		)
	}
	const segments = normalized.split("/")
	for (const seg of segments) {
		if (seg.length === 0 || seg === "." || seg === "..") {
			throw invalid(
				"plugin.container_extract_failed",
				`archive entry has an unsafe path: "${name}"`,
				{ name },
			)
		}
		if (hasControlChar(seg)) {
			throw invalid(
				"plugin.container_extract_failed",
				`archive entry contains control characters: "${name}"`,
				{ name },
			)
		}
	}
	return segments.join("/")
}

/** True when any char code is a control character (C0 or DEL). */
function hasControlChar(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i)
		if (code < 0x20 || code === 0x7f) return true
	}
	return false
}

/** Probe one extracted image's header window for dimensions. */
async function probeImageHead(
	probeImage: NonNullable<ExtractArchiveDeps["probeImage"]>,
	filePath: string,
	name: string,
): Promise<ImageProbeResult | undefined> {
	const head = await readFile(filePath).then((b) =>
		b.subarray(0, PROBE_HEADER_BYTES),
	)
	if (head.length === 0) return undefined
	const ext = name.slice(name.lastIndexOf(".")).toLowerCase()
	return probeImage(head, ext)
}
