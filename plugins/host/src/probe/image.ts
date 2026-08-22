import { extname } from "node:path"
import type { Readable } from "node:stream"
import { IMAGE_EXTS } from "@hoardodile/sdk-types/media-exts"
import { PROBE_HEADER_BYTES } from "../archive/index.ts"

import type { ImageInfo } from "../types.ts"

/**
 * Max zip entry size read into memory for thumb synthesis. Larger
 * entries are materialized to disk before sharp/ffmpeg runs.
 */
export const THUMB_BUFFER_MAX_BYTES = 32 * 1024 * 1024

/**
 * Image probing via sharp. sharp is loaded lazily and declared as an
 * optional peer dependency: the host package stays free of native
 * binaries, and consumers that never probe images (the browser-side mock,
 * dependency-light CI installs) never pull it in. When sharp is missing,
 * probe calls fail loudly instead of degrading silently.
 */
type SharpModule = typeof import("sharp")

let sharpPromise: Promise<SharpModule> | undefined

export function loadSharp(): Promise<SharpModule> {
	sharpPromise ??= import("sharp").catch((err: unknown) => {
		sharpPromise = undefined
		throw new Error(
			`sharp is not installed — add "sharp" to your dependencies to enable image probing: ${err instanceof Error ? err.message : String(err)}`,
		)
	})
	return sharpPromise
}

export type ImageSourceProbe = {
	readonly width: number
	readonly height: number
	readonly animated: boolean
}

const ANIMATED_EXT_HINTS = new Set([".gif", ".webp", ".avif"])

export { PROBE_HEADER_BYTES } from "../archive/index.ts"

/** True when `ext` names a format that can carry animation. */
export function isAnimatedCandidateExt(ext: string): boolean {
	return ANIMATED_EXT_HINTS.has(ext)
}

export type ImageMetadataInput =
	| string
	| Buffer
	| Readable
	| {
			readonly openStream: () => Promise<Readable>
			/**
			 * Optional byte-range read into the underlying source (e.g. a
			 * zip entry slice). When present, metadata probes read
			 * {@link PROBE_HEADER_BYTES} from the start instead of
			 * streaming the whole entry — libvips reads the ENTIRE file
			 * for metadata from a non-seekable stream, but only the header
			 * from a buffer.
			 */
			readonly readRange?: (start: number, end: number) => Promise<Buffer>
	  }

/**
 * Narrow a Node stream into sharp's readable input without assertion.
 * Async because the sharp module itself is loaded lazily.
 *
 * sharp's constructor rejects `sharp(stream, opts)` — for stream input
 * the input options must be passed AS the first argument (a plain object
 * of input parameters like `pages`/`animated`) and the readable piped
 * into the resulting Duplex.
 */
export async function sharpFromReadable(
	stream: Readable,
	options?: import("sharp").SharpOptions,
): Promise<import("sharp").Sharp> {
	if (typeof stream.read !== "function") {
		throw new Error("expected a readable stream")
	}
	const { default: sharp } = await loadSharp()
	const descriptor =
		options === undefined || Object.keys(options).length === 0
			? undefined
			: ({ ...options } as unknown as import("sharp").SharpInput)
	const instance = descriptor === undefined ? sharp() : sharp(descriptor)
	stream.pipe(instance)
	return instance
}

function isReadable(input: unknown): input is Readable {
	return (
		typeof input === "object" &&
		input !== null &&
		typeof (input as Readable).pipe === "function" &&
		!("openStream" in input)
	)
}

function isReopenableImageStream(
	input: ImageMetadataInput,
): input is { readonly openStream: () => Promise<Readable> } {
	return (
		typeof input === "object" &&
		input !== null &&
		!Buffer.isBuffer(input) &&
		"openStream" in input &&
		typeof (input as { openStream: unknown }).openStream === "function"
	)
}

/**
 * Sharp options for image thumb/probe reads. Enables sequential read for
 * large JPEGs on disk so libvips can shrink-on-load during resize.
 */
export function sharpImageInputOpts(
	input: string | Buffer,
	ext: string,
	pages: number,
	animated?: boolean,
): import("sharp").SharpOptions {
	const opts: import("sharp").SharpOptions = { pages }
	if (animated === true) opts.animated = true
	if (
		typeof input === "string" &&
		(ext === ".jpg" || ext === ".jpeg" || ext === ".jfif")
	) {
		opts.sequentialRead = true
	}
	return opts
}

/**
 * True when a shallow `{ pages: 1 }` metadata read is not enough to
 * decide animation and the full multi-page scan is required.
 */
export function needsFullAnimationScan(
	meta: Pick<
		import("sharp").Metadata,
		"width" | "height" | "pages" | "pageHeight"
	>,
	ext: string,
): boolean {
	if (ext === ".gif") return true
	if (ANIMATED_EXT_HINTS.has(ext) && (meta.pages ?? 1) > 1) return true
	if (
		meta.pageHeight !== undefined &&
		meta.height !== undefined &&
		meta.pageHeight !== meta.height
	) {
		return true
	}
	return false
}

/**
 * Buffer a probe stream with a hard byte cap. Only used for formats whose
 * animation scan needs the whole stream (GIF): probing only needs
 * metadata, so an entry bigger than the cap is treated as unprobed rather
 * than buffered whole into host memory.
 */
async function bufferCapped(
	input: Readable,
	maxBytes: number,
): Promise<Buffer> {
	const chunks: Uint8Array[] = []
	let total = 0
	for await (const chunk of input) {
		const bytes: Uint8Array =
			typeof chunk === "string" ? Buffer.from(chunk) : chunk
		total += bytes.byteLength
		if (total > maxBytes) {
			input.destroy()
			throw new Error(`probe input exceeds the ${maxBytes}-byte cap`)
		}
		chunks.push(bytes)
	}
	return Buffer.concat(chunks)
}

/**
 * Read image metadata with layered animation detection: static sources
 * stop after a single-page read; animated containers escalate to
 * `{ pages: -1 }` only when the shallow probe signals multi-frame input.
 */
export async function readImageMetadata(
	input: ImageMetadataInput,
	ext: string,
): Promise<{
	readonly meta: import("sharp").Metadata
	readonly animated: boolean
}> {
	if (isReopenableImageStream(input)) {
		// Header-slice fast path: probe a small leading window as a buffer
		// (header-only libvips read) instead of streaming the whole entry
		// (full-file read). Only definitive static results are accepted —
		// animation candidates escalate inside the slice read, and a
		// truncated buffer cannot complete a full scan, so those fall
		// through to the stream path where frame counts stay correct. GIF
		// is skipped outright (its frame count lives at the end).
		if (input.readRange !== undefined && ext !== ".gif") {
			const head = await input.readRange(0, PROBE_HEADER_BYTES)
			if (head.length > 0) {
				try {
					const { default: sharp } = await loadSharp()
					const shallowMeta = await sharp(
						head,
						sharpImageInputOpts(head, ext, 1),
					).metadata()
					if (!needsFullAnimationScan(shallowMeta, ext)) {
						return { meta: shallowMeta, animated: false }
					}
				} catch {
					// Truncated header unreadable — fall through to the
					// stream path.
				}
			}
		}
		const stream = await input.openStream()
		const shallow = await sharpFromReadable(stream, { pages: 1 })
		const shallowMeta = await shallow.metadata()
		if (!needsFullAnimationScan(shallowMeta, ext)) {
			return { meta: shallowMeta, animated: false }
		}
		const fullStream = await input.openStream()
		const fullMeta = await sharpFromReadable(fullStream, {
			pages: -1,
			animated: true,
		}).then((s) => s.metadata())
		return { meta: fullMeta, animated: (fullMeta.pages ?? 1) > 1 }
	}
	if (isReadable(input)) {
		// GIF frame counts are not stored in the container header, so the
		// full animation scan needs the whole stream — buffer cap-guarded
		// and reuse the buffer path.
		if (ext === ".gif") {
			const data = await bufferCapped(input, THUMB_BUFFER_MAX_BYTES)
			return readImageMetadata(data, ext)
		}
		// Static formats: hand the stream straight to sharp so the probe
		// reads only the header bytes. (Buffering the whole entry first —
		// the previous behavior, capped at THUMB_BUFFER_MAX_BYTES — turned
		// every stream probe into a full read and made entries beyond the
		// cap unprobeable.)
		try {
			const shallow = await sharpFromReadable(input, { pages: 1 })
			const shallowMeta = await shallow.metadata()
			if (!needsFullAnimationScan(shallowMeta, ext)) {
				return { meta: shallowMeta, animated: false }
			}
			// Animated candidates (webp/avif/tiff) report their total page
			// count from the container header, so the shallow read is
			// conclusive — and the stream cannot be rewound for a full
			// scan anyway.
			return {
				meta: shallowMeta,
				animated: (shallowMeta.pages ?? 1) > 1,
			}
		} finally {
			input.destroy()
		}
	}
	const { default: sharp } = await loadSharp()
	const shallow = sharp(input, sharpImageInputOpts(input, ext, 1))
	const shallowMeta = await shallow.metadata()
	if (!needsFullAnimationScan(shallowMeta, ext)) {
		return { meta: shallowMeta, animated: false }
	}
	const fullMeta = await sharp(
		input,
		sharpImageInputOpts(input, ext, -1, true),
	).metadata()
	return { meta: fullMeta, animated: (fullMeta.pages ?? 1) > 1 }
}

/**
 * Probe an image path or buffer and return pixel dimensions plus whether
 * the source is animated. Probe failures return `undefined`.
 */
export async function probeImageSource(
	input: ImageMetadataInput,
	extHint?: string,
): Promise<ImageSourceProbe | undefined> {
	const ext =
		extHint ?? (typeof input === "string" ? extname(input).toLowerCase() : "")
	if (ext.length > 0 && !IMAGE_EXTS.has(ext)) return undefined
	try {
		const { meta, animated } = await readImageMetadata(input, ext)
		const h = meta.pageHeight ?? meta.height
		if (meta.width === undefined || h === undefined) return undefined
		return { width: meta.width, height: h, animated }
	} catch {
		return undefined
	}
}

/**
 * Probe an image source and return its pixel dimensions. Probe failures
 * return `undefined` so callers can treat "not yet probed" and "probe
 * failed" the same way.
 */
export async function probeImage(
	source: ImageMetadataInput,
): Promise<ImageInfo | undefined> {
	const probe = await probeImageSource(source)
	if (probe === undefined) return undefined
	return { width: probe.width, height: probe.height }
}

/**
 * True when the image has more than one frame (animated GIF / WebP / APNG /
 * AVIF). Uses layered detection so static JPEG/PNG avoid a full-frame scan.
 * Errors are coerced to `false`.
 */
export async function probeAnimatedImage(
	source: ImageMetadataInput,
): Promise<boolean> {
	if (
		typeof source === "string" &&
		!IMAGE_EXTS.has(extname(source).toLowerCase())
	) {
		return false
	}
	try {
		const probe = await probeImageSource(source)
		return probe?.animated ?? false
	} catch (err) {
		const label = typeof source === "string" ? source : "stream"
		console.warn(
			`[probeAnimatedImage] sharp failed on ${label}: ${err instanceof Error ? err.message : String(err)}`,
		)
		return false
	}
}
