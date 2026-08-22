import type { Readable } from "node:stream"
import type {
	ContainerListing,
	ImageHashKind,
	PluginSchema,
} from "@hoardodile/sdk-types"
import { fileTypeFromName } from "@hoardodile/sdk-types"
import { MIME_FFMPEG_INPUT_FORMAT } from "@hoardodile/sdk-types/media-exts"
import { PLUGIN_READ_FILE_MAX_BYTES } from "@hoardodile/sdk-types/plugin"
import type { ArchiveEntry, NestedCdCache } from "./archive/index.ts"
import {
	type ArchiveExtractor,
	createArchiveExtractor,
	type ExtractionResult,
	type ExtractProgress,
} from "./archive/index.ts"
import type { ResourceContainer } from "./container.ts"
import {
	computeDHash,
	computePHash,
	grayStddev,
	hashStream,
	MIN_PERCEPTUAL_STDDEV,
	PERCEPTUAL_HASH_KINDS,
	PHASH_GRID,
} from "./hash.ts"
import { createNestedAwareContainer } from "./nested-view.ts"
import type { AvProbeOptions } from "./probe/av.ts"
import {
	type ImageMetadataInput,
	type ImageSourceProbe,
	isAnimatedCandidateExt,
	PROBE_HEADER_BYTES,
	sharpFromReadable,
} from "./probe/image.ts"
import { SNIFF_HEADER_BYTES, sniffBytes } from "./probe/sniff.ts"
import type { PluginProbeCache } from "./probe-cache.ts"
import type {
	FileType,
	ProbeResult,
	ReadFileRange,
	ResourceAPI,
} from "./types.ts"

// The directory-backed ResourceAPI is part of the host so the CLI and the
// contract suite run the same implementation the server's import path uses.
export {
	createDirectoryResourceAPI as createImportResourceAPI,
	resolveSafeImportPath,
} from "./directory-api.ts"

/**
 * Construct a {@link ResourceAPI} on top of a {@link ResourceContainer}.
 * The container abstracts away the storage shape (bare-file resource
 * folder, raw directory, in-memory fixture) so plugin code stays
 * unaware of how source bytes are stored.
 */
export type CreatePluginResourceAPIDeps = {
	readonly view: ResourceContainer
	/**
	 * Probe implementations, both optional: when absent the matching
	 * branch of `probe` resolves to
	 * `{ kind: "unknown", reason: "unavailable" }` without opening any
	 * stream — the directory backend ships without probes by design.
	 * `sniff` never needs a backend; it reads the file's own header.
	 */
	readonly probeImage?: (
		source: ImageMetadataInput,
		extHint?: string,
	) => Promise<ImageSourceProbe | undefined>
	readonly probeAv?: (
		source: string | Readable,
		opts: AvProbeOptions,
	) => Promise<ProbeResult>
	/** Per-call `readFile` byte cap. Defaults to {@link PLUGIN_READ_FILE_MAX_BYTES}. */
	readonly maxReadFileBytes?: number
	/**
	 * Process-wide probe cache. Only active together with
	 * {@link cacheScope}; without it every probe opens a fresh stream.
	 */
	readonly probeCache?: PluginProbeCache
	/**
	 * Cache namespace for this API instance, typically
	 * `${resId}:${fileVersion}`. Archives are immutable per version, so
	 * cached probe results never need explicit invalidation.
	 */
	readonly cacheScope?: string
	/**
	 * Absolute directory for plugin container extractions (e.g. the
	 * server's `local/cache/resources/<id>/extracted/v<N>/archives`, or a
	 * temp dir for the CLI). When absent, `extractArchive` rejects with
	 * a clear message.
	 */
	readonly extractCacheDir?: string
	/**
	 * Hard caps for one `extractArchive` call. Defaults to
	 * {@link DEFAULT_PLUGIN_EXTRACT_MAX_BYTES} /
	 * {@link DEFAULT_PLUGIN_EXTRACT_MAX_ENTRIES}.
	 */
	readonly maxExtractBytes?: number
	readonly maxExtractEntries?: number
	/**
	 * Called with per-entry materialization progress during
	 * `extractArchive`, so the server can surface it to the user.
	 */
	readonly onExtractProgress?: (progress: ExtractProgress) => void
	/**
	 * Process-wide nested central-directory cache. When provided, virtual
	 * path resolution (`outer!inner`) reuses parsed listings across hook
	 * calls instead of re-reading each archive's CD per invocation. The
	 * server passes one cache per (resId, fileVersion) scope.
	 */
	readonly nestedCdCache?: NestedCdCache
	/**
	 * Session context handed to hooks as `api.context.detect`: the
	 * payload a prior `detect` invocation returned on a successful
	 * match. The sandbox worker injects it itself; this escape hatch
	 * lets in-process hosts (the dev runner) do the same.
	 */
	readonly detectContext?: unknown
}

export const DEFAULT_PLUGIN_EXTRACT_MAX_BYTES = 8 * 1024 * 1024 * 1024
export const DEFAULT_PLUGIN_EXTRACT_MAX_ENTRIES = 200_000

export function createPluginResourceAPI<
	TSchema extends PluginSchema = PluginSchema,
>(deps: CreatePluginResourceAPIDeps): ResourceAPI<TSchema> {
	// Virtual paths (`outer!inner`) resolve through this wrapper, so
	// readFile/sniff/probe/stat/hash all reach into nested containers.
	// The cacheScope disambiguates nested-cache keys when one shared
	// cache serves many resources (see createNestedAwareContainer); the
	// extract cache dir extends virtual addressing to *extracted*
	// archives (non-zip formats become addressable once materialized).
	const view = createNestedAwareContainer(
		deps.view,
		deps.nestedCdCache,
		deps.cacheScope,
		deps.extractCacheDir,
	)
	const maxReadFileBytes = deps.maxReadFileBytes ?? PLUGIN_READ_FILE_MAX_BYTES

	const extractor: ArchiveExtractor | undefined =
		deps.extractCacheDir === undefined
			? undefined
			: createArchiveExtractor({
					outer: {
						sizeOf: (rel) =>
							deps.view.resolveByteRange(rel).then((r) => r?.size),
						readSlice: (rel, start, end) =>
							deps.view.readEntrySlice(rel, start, end),
					},
					cacheDir: deps.extractCacheDir,
					maxBytes: deps.maxExtractBytes ?? DEFAULT_PLUGIN_EXTRACT_MAX_BYTES,
					maxEntries:
						deps.maxExtractEntries ?? DEFAULT_PLUGIN_EXTRACT_MAX_ENTRIES,
					probeImage: deps.probeImage,
					onProgress: deps.onExtractProgress,
					nestedCdCache: deps.nestedCdCache,
				})

	async function readFileScoped(
		path: string,
		range?: ReadFileRange,
	): Promise<Uint8Array> {
		if (range === undefined) {
			const size = (await view.resolveByteRange(path))?.size
			if (size !== undefined) assertReadSize(path, size, maxReadFileBytes)
			const buf = await view.readEntry(path)
			return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
		}
		const start = Math.max(0, range.start ?? 0)
		const size = (await view.resolveByteRange(path))?.size
		if (size === undefined) {
			// Unknown size (missing entry) — let the view raise its own error.
			return toUint8Array(
				await view.readEntrySlice(path, start, range.end ?? start),
			)
		}
		const end = Math.min(range.end ?? size, size)
		assertReadSize(path, Math.max(0, end - start), maxReadFileBytes)
		return toUint8Array(await view.readEntrySlice(path, start, end))
	}

	async function listFileNamesScoped(): Promise<readonly string[]> {
		return view.listEntries()
	}

	/**
	 * Run `compute` through the shared probe cache when configured. The
	 * cache key carries the computation kind — sniffing an entry and
	 * decoding it are different results for the same path.
	 */
	function cached<T extends object | boolean | undefined>(
		kind: string,
		path: string,
		compute: () => Promise<T>,
	): Promise<T> {
		if (deps.probeCache === undefined || deps.cacheScope === undefined) {
			return compute()
		}
		return deps.probeCache.getOrCompute(
			`${deps.cacheScope}:${kind}:${path}`,
			compute,
		)
	}

	function sniffScoped(path: string): Promise<FileType | undefined> {
		return cached("sniff", path, async () => {
			// A missing or unreadable entry has no type — identification
			// never rejects, so callers can sniff freely while walking a
			// file list that may be stale.
			const head = await view
				.readEntrySlice(path, 0, SNIFF_HEADER_BYTES)
				.catch(() => undefined)
			if (head === undefined) return undefined
			return sniffBytes(head, path)
		})
	}

	/**
	 * Image metadata plus animation in one pass. Static formats answer
	 * from a header slice (libvips reads the ENTIRE entry for metadata
	 * from a stream, but only the header from a buffer); animation
	 * candidates (gif/webp/avif) must stream, because a truncated buffer
	 * cannot complete the frame scan and would report an animated source
	 * as static.
	 */
	async function probeImageEntry(
		path: string,
		type: FileType,
	): Promise<ProbeResult> {
		const probeImage = deps.probeImage
		if (probeImage === undefined) {
			return { kind: "unknown", reason: "unavailable" }
		}
		if (!isAnimatedCandidateExt(type.ext)) {
			const head = await view.readEntrySlice(path, 0, PROBE_HEADER_BYTES)
			if (head.length > 0) {
				const probed = await probeImage(head, type.ext).catch(() => undefined)
				if (probed !== undefined) return imageResult(type.mime, probed)
			}
		}
		try {
			const { stream } = await view.openEntryStream(path)
			const probed = await probeImage(stream, type.ext)
			if (probed !== undefined) return imageResult(type.mime, probed)
		} catch (err) {
			console.warn(
				`[probe] path=${path} image probe threw: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
		return { kind: "unknown", reason: "failed" }
	}

	/**
	 * Audio/video metadata. The ffmpeg container hint comes from the
	 * sniffed MIME type rather than the filename, so a mislabelled entry
	 * still demuxes; ISO-BMFF sources keep their index at the end of the
	 * file, so a pipe probe can legitimately fail and resolve to
	 * `{ kind: "unknown", reason: "failed" }`.
	 */
	async function probeAvEntry(
		path: string,
		type: FileType,
	): Promise<ProbeResult> {
		const probeAv = deps.probeAv
		if (probeAv === undefined) {
			return { kind: "unknown", reason: "unavailable" }
		}
		const inputFormat = MIME_FFMPEG_INPUT_FORMAT[type.mime]
		if (inputFormat === undefined) {
			return { kind: "unknown", reason: "unsupported" }
		}
		try {
			const { stream } = await view.openEntryStream(path)
			return await probeAv(stream, { mime: type.mime, inputFormat })
		} catch {
			return { kind: "unknown", reason: "failed" }
		}
	}

	function probeScoped(path: string): Promise<ProbeResult> {
		return cached("probe", path, async () => {
			const type = await sniffScoped(path)
			if (type === undefined) {
				return { kind: "unknown", reason: "unsupported" } as const
			}
			switch (type.kind) {
				case "image":
					return probeImageEntry(path, type)
				case "video":
				case "audio":
					return probeAvEntry(path, type)
				default:
					return { kind: "other", mime: type.mime } as const
			}
		})
	}

	async function statFileScoped(
		path: string,
	): Promise<{ readonly sizeBytes: number } | undefined> {
		const range = await view.resolveByteRange(path)
		if (range === undefined) return undefined
		return { sizeBytes: range.size }
	}

	async function statFilesScoped(
		paths: readonly string[],
	): Promise<readonly ({ readonly sizeBytes: number } | undefined)[]> {
		// Batch resolution: the zip CD cache makes every range lookup a
		// warm map hit; parallelizing keeps the fan-out bounded by the
		// plugin's own concurrency when it chunks the input.
		return Promise.all(paths.map(statFileScoped))
	}

	async function hashBytesScoped(
		path: string,
		algo: "md5" | "sha256",
	): Promise<string> {
		const { stream } = await view.openEntryStream(path)
		return hashStream(stream, algo)
	}

	async function computeImageHashesScoped(
		path: string,
		kinds: readonly ImageHashKind[],
	): Promise<Readonly<Record<ImageHashKind, string>> | undefined> {
		// Hashing follows the content, not the name: an image with a
		// wrong extension is still a duplicate of itself.
		const type = await sniffScoped(path)
		if (type?.kind !== "image") return undefined
		const result: Partial<Record<ImageHashKind, string>> = {}
		if (kinds.includes("sha256")) {
			const { stream } = await view.openEntryStream(path)
			result.sha256 = await hashStream(stream, "sha256")
		}
		const perceptual = kinds.filter((kind) =>
			PERCEPTUAL_HASH_KINDS.includes(kind),
		)
		if (perceptual.length > 0) {
			const { stream } = await view.openEntryStream(path)
			const gray = await decodeGrayGrid(stream)
			if (gray !== undefined && grayStddev(gray) >= MIN_PERCEPTUAL_STDDEV) {
				if (perceptual.includes("dhash")) result.dhash = computeDHash(gray)
				if (perceptual.includes("phash")) result.phash = computePHash(gray)
			} else if (result.sha256 === undefined) {
				// Not a decodable image (or too flat for a meaningful
				// perceptual hash) and no byte hash requested.
				return undefined
			}
		}
		return result as Readonly<Record<ImageHashKind, string>>
	}

	/**
	 * Decode one frame of the entry as a `PHASH_GRID × PHASH_GRID`
	 * grayscale buffer. Animated sources render their first frame
	 * (sharp's default with `pages: 1`). Undecodable input resolves to
	 * `undefined`.
	 */
	async function decodeGrayGrid(
		stream: Readable,
	): Promise<Uint8Array | undefined> {
		try {
			const instance = await sharpFromReadable(stream, { pages: 1 })
			const { data } = await instance
				.resize(PHASH_GRID, PHASH_GRID, { fit: "fill" })
				.grayscale()
				.raw()
				.toBuffer({ resolveWithObject: true })
			return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
		} catch {
			return undefined
		}
	}

	return {
		// No-ops: the sandbox host is the plugin log sink — it alone knows
		// which plugin emitted the line (see dispatchLog in sandbox/host.ts).
		logInfo() {},
		logWarn() {},
		logError() {},
		// The payload is opaque to this factory (hosts pass `unknown`);
		// the schema generic only types it for schema-aware consumers.
		context: { detect: deps.detectContext as TSchema["detect"] | undefined },
		listFileNames: listFileNamesScoped,
		readFile: readFileScoped,
		statFile: statFileScoped,
		statFiles: statFilesScoped,
		sniff: sniffScoped,
		probe: probeScoped,
		hashBytes: hashBytesScoped,
		computeImageHashes: computeImageHashesScoped,
		listContainer: (filename) => listContainerScoped(filename, extractor),
		extractArchive: (filename) => extractArchiveScoped(filename, extractor),
	}
}

/**
 * List a container entry's files without materializing — metadata-only
 * consumers (detect, card counts) use this so a preview never pays for
 * extraction it does not need.
 */
async function listContainerScoped(
	filename: string,
	extractor: ArchiveExtractor | undefined,
): Promise<ContainerListing> {
	if (extractor === undefined) {
		throw new Error(
			`listContainer("${filename}") — this host has no container support; only the archive-backed server host lists containers`,
		)
	}
	const entries = await extractor.list(filename)
	if (entries === undefined) {
		throw new Error(
			`listContainer("${filename}") — not a supported archive (zip/tar/7z/rar/xz), or no 7-Zip binary for non-zip formats`,
		)
	}
	return { entries: entries.map(bareContainerEntry) }
}

/** Convert a listed entry to the wire shape (no dimensions). */
function bareContainerEntry(
	entry: ArchiveEntry,
): ContainerListing["entries"][number] {
	return {
		path: entry.name,
		sizeBytes: entry.sizeBytes,
		kind: fileTypeFromName(entry.name)?.kind ?? "other",
	}
}

/**
 * Materialize the container entry `filename` into the configured cache
 * directory (or list its contents without writing in read-only mode).
 * Rejects when this API instance has no extraction cache wired.
 */
async function extractArchiveScoped(
	filename: string,
	extractor: ArchiveExtractor | undefined,
): Promise<ExtractionResult> {
	if (extractor === undefined) {
		throw new Error(
			`extractArchive("${filename}") — this host has no extraction cache; only the archive-backed server host materializes containers`,
		)
	}
	return extractor.extract(filename)
}

/** Assemble the image branch of a {@link ProbeResult}. */
function imageResult(mime: string, probed: ImageSourceProbe): ProbeResult {
	return {
		kind: "image",
		mime,
		width: probed.width,
		height: probed.height,
		animated: probed.animated,
	}
}

function assertReadSize(path: string, sizeBytes: number, max: number): void {
	if (sizeBytes > max) {
		throw new Error(
			`readFile("${path}") requests ${sizeBytes} bytes, exceeding the per-call limit of ${max} bytes — pass a byte range or use readFileChunks()`,
		)
	}
}

function toUint8Array(buf: Buffer): Uint8Array {
	return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}
