import { extname } from "node:path"
import type { Readable } from "node:stream"
import type { FileType } from "@hoardodile/sdk-types"
import type { MediaKind } from "@hoardodile/sdk-types/media-exts"
import type { ResourceContainer } from "../container.ts"
import { notFound } from "../errors.ts"
import {
	SNIFF_HEADER_BYTES,
	sniffBytes,
	THUMB_BUFFER_MAX_BYTES,
} from "../probe/index.ts"
import type { PluginProbeCache } from "../probe-cache.ts"
import type { ImageThumbInput } from "../render/index.ts"

export type ThumbInput =
	| { readonly kind: "path"; readonly path: string }
	| { readonly kind: "buffer"; readonly buffer: Buffer }
	| {
			readonly kind: "stream"
			readonly openStream: () => Promise<Readable>
			readonly size: number
			/**
			 * Byte-range read into the entry (zip slice). Lets the render
			 * pipeline's metadata step read a small header window instead
			 * of streaming the whole entry — libvips full-reads
			 * non-seekable input for metadata.
			 */
			readonly readRange?: (start: number, end: number) => Promise<Buffer>
	  }

export function imageThumbSource(input: ThumbInput): ImageThumbInput {
	if (input.kind === "path") return input.path
	if (input.kind === "buffer") return input.buffer
	if (input.kind === "stream") {
		return input.readRange === undefined
			? { openStream: input.openStream }
			: { openStream: input.openStream, readRange: input.readRange }
	}
	throw new Error("unsupported image thumb input")
}

/**
 * Resolve an ffmpeg-bound entry (video, or audio whose embedded artwork
 * ffmpeg demuxes as a still video stream) into a path or stream. ffmpeg
 * reads both from `pipe:0`, so the two share one shape.
 */
export async function ffmpegThumbSource(
	input: ThumbInput,
): Promise<string | Readable> {
	if (input.kind === "path") return input.path
	if (input.kind === "stream") return input.openStream()
	throw new Error("unsupported ffmpeg thumb input")
}

function streamThumbInput(
	container: ResourceContainer,
	relPath: string,
	size: number,
): ThumbInput {
	return {
		kind: "stream",
		openStream: () =>
			container.openEntryStream(relPath).then((entry) => entry.stream),
		readRange: (start, end) => container.readEntrySlice(relPath, start, end),
		size,
	}
}

/**
 * Prefer a seekable on-disk path over a stream when the container can
 * provide one (bare-file backends): libvips/ffmpeg open the file
 * directly — mmap + shrink-on-load for images, no pipe for video —
 * with none of the pipe-copy overhead. Containers without the
 * capability (in-memory fixtures, virtual `outer!inner` entries) fall
 * back to streaming.
 */
async function pathOrStreamThumbInput(
	container: ResourceContainer,
	relPath: string,
	size: number,
): Promise<ThumbInput> {
	const path = await container.resolveSeekablePath?.(relPath)
	if (path !== undefined) return { kind: "path", path }
	return streamThumbInput(container, relPath, size)
}

/**
 * Identify a container entry from its bytes, falling back to its name.
 * The thumbnail pipeline and the plugins that pick cover files must
 * agree on what a file is, so both go through the same sniffer — an
 * entry the plugin selected as an image never lands in the ffmpeg branch
 * because of a misleading extension.
 */
async function sniffEntry(
	container: ResourceContainer,
	relPath: string,
	opts: WithThumbInputOptions | undefined,
): Promise<FileType | undefined> {
	const readHead = async (): Promise<Buffer | undefined> =>
		container
			.readEntrySlice(relPath, 0, SNIFF_HEADER_BYTES)
			.catch(() => undefined)
	const head =
		opts?.probeCache !== undefined && opts.cacheScope !== undefined
			? await opts.probeCache.getOrCompute(
					`${opts.cacheScope}:sniff:${relPath}`,
					readHead,
				)
			: await readHead()
	if (head === undefined) return undefined
	return sniffBytes(head, relPath)
}

export type WithThumbInputOptions = {
	/**
	 * Identifier used in the missing-entry error message (e.g. the
	 * resource id).
	 */
	readonly label?: string
	/**
	 * Shared probe cache, keyed by `cacheScope` — pass the same instance
	 * and scope the plugin API uses so sniff results are reused across
	 * hook runs and thumb jobs for one resource version.
	 */
	readonly probeCache?: PluginProbeCache
	readonly cacheScope?: string
}

/**
 * Resolve a container entry into the cheapest readable form for thumb
 * synthesis: small images are read into memory; larger images, videos
 * and audio stream directly from the source file without extracted-cache
 * writes.
 *
 * `expected` guards the caller's assumption — `"any"` accepts whatever
 * the entry turns out to be. The callback receives the **sniffed**
 * extension, so sharp and ffmpeg get the container hint the content
 * actually warrants.
 */
export async function withThumbInput<T>(
	container: ResourceContainer,
	relPath: string,
	expected: MediaKind | "any",
	fn: (input: ThumbInput, ext: string, kind: MediaKind) => Promise<T>,
	opts?: WithThumbInputOptions,
): Promise<T> {
	const type = await sniffEntry(container, relPath, opts)
	const kind = type?.kind ?? "other"
	// An unidentified entry keeps the caller's expectation so the ffmpeg
	// path still gets its chance, exactly as the extension fallback did.
	const ext = type?.ext ?? extname(relPath).toLowerCase()
	const effective: MediaKind =
		type === undefined && expected !== "any" ? expected : kind
	if (expected !== "any" && effective !== expected) {
		throw new Error(`unsupported thumb media kind ${effective} for ${relPath}`)
	}
	if (effective === "image") {
		const range = await requireEntryRange(container, relPath, opts?.label)
		if (range.size <= THUMB_BUFFER_MAX_BYTES) {
			const buffer = await container.readEntry(relPath)
			return fn({ kind: "buffer", buffer }, ext, effective)
		}
		return fn(
			await pathOrStreamThumbInput(container, relPath, range.size),
			ext,
			effective,
		)
	}
	if (effective === "video" || effective === "audio") {
		const range = await requireEntryRange(container, relPath, opts?.label)
		return fn(
			await pathOrStreamThumbInput(container, relPath, range.size),
			ext,
			effective,
		)
	}
	throw new Error(`unsupported thumb media kind ${effective} for ${relPath}`)
}

async function requireEntryRange(
	container: ResourceContainer,
	relPath: string,
	label: string | undefined,
): Promise<{ readonly size: number }> {
	const range = await container.resolveByteRange(relPath)
	if (range === undefined) {
		throw notFound(
			"resource.file_not_found",
			`resource ${label ?? "?"} has no entry ${relPath}`,
			{ resId: label, relPath },
		)
	}
	return range
}
