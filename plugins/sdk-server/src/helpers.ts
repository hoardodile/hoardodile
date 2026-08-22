import type {
	FileType,
	ImageHash,
	ImageHashesResult,
	ImageHashKind,
	ResourceAPI,
} from "@hoardodile/sdk-types"
import {
	PLUGIN_IMAGE_PROBE_CONCURRENCY,
	PLUGIN_VIDEO_PROBE_CONCURRENCY,
} from "@hoardodile/sdk-types/plugin"
import {
	RESOURCE_PREVIEW_MAX_AREA,
	RESOURCE_PREVIEW_SIZE_THRESHOLD,
} from "@hoardodile/sdk-types/resource"

/**
 * True when an image exceeds the preview thresholds — the pixel-area
 * cap **or** the byte-size threshold — and should be served through the
 * preview pipeline instead of the original. Format-driven transcode
 * needs (formats browsers cannot render natively) are decided by the
 * consuming plugin separately.
 */
function exceedsPreviewThresholds(check: {
	readonly width: number | undefined
	readonly height: number | undefined
	readonly sizeBytes: number | undefined
}): boolean {
	const { width, height, sizeBytes } = check
	const exceedsArea =
		width !== undefined &&
		height !== undefined &&
		width * height > RESOURCE_PREVIEW_MAX_AREA
	const exceedsSize =
		sizeBytes !== undefined && sizeBytes > RESOURCE_PREVIEW_SIZE_THRESHOLD
	return exceedsArea || exceedsSize
}

/** Return the lower-cased extension from the last dot, or `""` when there is none. */
export function extname(filename: string): string {
	const dot = filename.lastIndexOf(".")
	if (dot === -1) return ""
	return filename.slice(dot).toLowerCase()
}

/** Natural-sort filenames (case-insensitive, numeric). Mutates and returns. */
export function naturalSort(files: readonly string[]): string[] {
	return [...files].sort((a, b) =>
		a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
	)
}

/**
 * Map items with at most `limit` promises in flight. Results keep input
 * order; the first rejection aborts the map (in-flight calls settle).
 * Probe loops use this to fan out across the host's concurrent API
 * dispatch instead of trickling one RPC at a time.
 */
export async function mapConcurrent<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length)
	let next = 0
	async function lane(): Promise<void> {
		for (;;) {
			const index = next++
			if (index >= items.length) return
			const item = items[index]
			if (item === undefined) continue
			results[index] = await fn(item, index)
		}
	}
	const lanes = Math.max(1, Math.min(limit, items.length))
	const runners: Promise<void>[] = []
	for (let i = 0; i < lanes; i++) runners.push(lane())
	await Promise.all(runners)
	return results
}

/** File-list item shapes produced by the probe helpers. */
type ProbedImageFile = {
	readonly type: "image"
	readonly width?: number
	readonly height?: number
	readonly preview: boolean
}
type ProbedVideoFile = {
	readonly type: "video"
	readonly width?: number
	readonly height?: number
	readonly durationMs?: number
}
type ProbedAudioFile = {
	readonly type: "audio"
	readonly durationMs?: number
	readonly hasCoverArt?: boolean
}

/**
 * Probe a file and return the file-item shaped object matching what the
 * content actually is, or `undefined` for non-media files. This is the
 * primitive: plugins that accept mixed media route on the result
 * instead of pre-sorting by extension, and the three per-kind helpers
 * below are thin narrowings of it.
 *
 * When identification succeeds but decoding does not (no ffprobe on the
 * host, a damaged container), the file keeps its media type and simply
 * carries no dimensions — losing the entry entirely would be worse than
 * showing it undecorated.
 */
export async function probeMediaFile(
	api: ResourceAPI,
	filename: string,
): Promise<ProbedImageFile | ProbedVideoFile | ProbedAudioFile | undefined> {
	const probed = await api.probe(filename)
	switch (probed.kind) {
		case "image": {
			const { width, height } = probed
			const sizeBytes = (await api.statFile(filename))?.sizeBytes
			return {
				type: "image",
				width,
				height,
				preview: exceedsPreviewThresholds({ width, height, sizeBytes }),
			}
		}
		case "video":
			return {
				type: "video",
				width: probed.width,
				height: probed.height,
				durationMs: probed.durationMs,
			}
		case "audio":
			return {
				type: "audio",
				durationMs: probed.durationMs,
				hasCoverArt: probed.coverArt === undefined ? undefined : true,
			}
		case "other":
			return undefined
		default:
			return undecodedItem(await api.sniff(filename))
	}
}

/** Bare file item for media the host identified but could not decode. */
function undecodedItem(
	type: FileType | undefined,
): ProbedImageFile | ProbedVideoFile | ProbedAudioFile | undefined {
	switch (type?.kind) {
		case "image":
			return { type: "image", preview: false }
		case "video":
			return { type: "video" }
		case "audio":
			return { type: "audio" }
		default:
			return undefined
	}
}

/**
 * Probe a file expected to be an image. A file that turns out not to be
 * one still yields an image-shaped item (with no dimensions), so a file
 * list keeps its declared type.
 */
export async function probeImageFile(
	api: ResourceAPI,
	filename: string,
): Promise<ProbedImageFile> {
	const item = await probeMediaFile(api, filename)
	return item?.type === "image" ? item : { type: "image", preview: false }
}

/** Probe a file expected to be a video. See {@link probeImageFile}. */
export async function probeVideoFile(
	api: ResourceAPI,
	filename: string,
): Promise<ProbedVideoFile> {
	const item = await probeMediaFile(api, filename)
	return item?.type === "video" ? item : { type: "video" }
}

/** Probe a file expected to be audio. See {@link probeImageFile}. */
export async function probeAudioFile(
	api: ResourceAPI,
	filename: string,
): Promise<ProbedAudioFile> {
	const item = await probeMediaFile(api, filename)
	return item?.type === "audio" ? item : { type: "audio" }
}

/**
 * One entry of {@link mediaFileList}: the filename plus everything the
 * probe pass learned about the file (`sniffed` is the sniffed type that
 * decided the probe lane — the same data the entry's dimensions were
 * routed on).
 */
export type MediaFileListEntry = {
	readonly filename: string
	readonly sniffed?: FileType
} & (ProbedImageFile | ProbedVideoFile | ProbedAudioFile)

export type MediaFileListOptions = {
	/**
	 * Candidate names to probe. When absent the helper lists the
	 * resource itself (natural-sorted). Pass a pre-filtered list (e.g.
	 * top-level files only) to skip names the plugin never wants.
	 */
	readonly names?: readonly string[]
}

/**
 * Build a typed media file list in one pass: sniff every candidate,
 * then probe images and timed media (video/audio) in separate bounded
 * lanes — sharp header reads fan out wider than ffprobe spawns. The
 * result keeps input order and drops files that are not decodable
 * media. The one-call implementation for a `listFiles` hook over a
 * flat media resource.
 */
export async function mediaFileList(
	api: ResourceAPI,
	opts: MediaFileListOptions = {},
): Promise<readonly MediaFileListEntry[]> {
	// `listFileNames` already returns the host's canonical order (the
	// `.order` upload order, natural name sort otherwise) — re-sorting
	// here would scramble it. Plugins wanting a different order pass
	// explicit `names`.
	const files = opts.names ?? (await api.listFileNames())
	const types = await mapConcurrent(
		files,
		PLUGIN_IMAGE_PROBE_CONCURRENCY,
		(name) => api.sniff(name),
	)
	const entries = new Map<string, MediaFileListEntry>()
	const imageIndexes: number[] = []
	const timedIndexes: number[] = []
	for (const index of files.keys()) {
		const kind = types[index]?.kind
		if (kind === "image") imageIndexes.push(index)
		else if (kind === "video" || kind === "audio") timedIndexes.push(index)
	}

	async function probeInto(index: number): Promise<void> {
		const filename = files[index]
		if (filename === undefined) return
		const probed = await probeMediaFile(api, filename)
		if (probed === undefined) return
		entries.set(filename, {
			filename,
			sniffed: types[index],
			...probed,
		})
	}

	await Promise.all([
		mapConcurrent(imageIndexes, PLUGIN_IMAGE_PROBE_CONCURRENCY, probeInto),
		mapConcurrent(timedIndexes, PLUGIN_VIDEO_PROBE_CONCURRENCY, probeInto),
	])

	const result: MediaFileListEntry[] = []
	for (const filename of files) {
		const entry = entries.get(filename)
		if (entry !== undefined) result.push(entry)
	}
	return result
}

/**
 * The `sourceMeta` for a bare file count — the one-liner for plugins
 * whose card needs only `fileCount`. Resolves to `undefined` for empty
 * resources, matching the host's "nothing to report" contract.
 */
export async function countSourceMeta(
	api: ResourceAPI,
): Promise<{ readonly fileCount: number } | undefined> {
	const files = await api.listFileNames()
	return files.length === 0 ? undefined : { fileCount: files.length }
}

export type ReadFileChunksOptions = {
	/** Chunk size in bytes. Defaults to 1 MiB. */
	readonly chunkSize?: number
}

/**
 * Stream a file as a sequence of chunks via ranged `readFile` calls.
 * Memory stays bounded by the chunk size on both sides of the plugin
 * boundary — the host never buffers the whole file.
 */
export async function* readFileChunks(
	api: ResourceAPI,
	path: string,
	opts: ReadFileChunksOptions = {},
): AsyncGenerator<Uint8Array, void, undefined> {
	const chunkSize = opts.chunkSize ?? 1024 * 1024
	let offset = 0
	for (;;) {
		const chunk = await api.readFile(path, {
			start: offset,
			end: offset + chunkSize,
		})
		if (chunk.byteLength === 0) return
		yield chunk
		if (chunk.byteLength < chunkSize) return
		offset += chunk.byteLength
	}
}

/** Per-file default hash kinds for {@link imageHashesFor}. */
export const DEFAULT_IMAGE_HASH_KINDS: readonly ImageHashKind[] = [
	"sha256",
	"dhash",
]

export type ImageHashesForOptions = {
	/** Hash kinds per image. Defaults to sha256 + dhash. */
	readonly kinds?: readonly ImageHashKind[]
}

/**
 * Compute the requested hash kinds of one image file as `ImageHash`
 * entries (`scope` = the file path). Resolves to `[]` for non-image or
 * undecodable files.
 */
export async function imageHashesForFile(
	api: ResourceAPI,
	scope: string,
	kinds: readonly ImageHashKind[] = DEFAULT_IMAGE_HASH_KINDS,
): Promise<readonly ImageHash[]> {
	const computed = await api.computeImageHashes(scope, kinds)
	if (computed === undefined) return []
	const entries: ImageHash[] = []
	for (const kind of kinds) {
		const value = computed[kind]
		if (value !== undefined) entries.push({ scope, type: kind, value })
	}
	return entries
}

/**
 * One-line `imageHashes` hook implementation for image plugins: hash
 * every image file of the resource (animated sources hash their first
 * frame). Image files are selected by content, so a mislabelled photo
 * is still deduplicated. Plugins facing image-less resources omit the
 * hook entirely.
 */
export async function imageHashesFor(
	api: ResourceAPI,
	opts: ImageHashesForOptions = {},
): Promise<ImageHashesResult> {
	const kinds = opts.kinds ?? DEFAULT_IMAGE_HASH_KINDS
	const names = await api.listFileNames()
	const types = await mapConcurrent(
		names,
		PLUGIN_IMAGE_PROBE_CONCURRENCY,
		(name) => api.sniff(name),
	)
	const images = names.filter((_, i) => types[i]?.kind === "image")
	const hashes = (
		await mapConcurrent(images, PLUGIN_IMAGE_PROBE_CONCURRENCY, (filename) =>
			imageHashesForFile(api, filename, kinds),
		)
	).flat()
	return { hashes }
}
