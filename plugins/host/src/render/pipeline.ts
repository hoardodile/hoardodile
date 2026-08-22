import { spawn } from "node:child_process"
import { mkdir, readdir, rename, rm } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import type { Readable } from "node:stream"
import type { ResolvedImageVariant } from "@hoardodile/sdk-types/image-variant"
import sharp, { type Sharp } from "sharp"
import {
	extToAudioInputFormat,
	extToFfmpegInputFormat,
	readImageMetadata,
	sharpFromReadable,
	sharpImageInputOpts,
} from "../probe/index.ts"
import type { FfmpegPaths } from "./ffmpeg.ts"

/**
 * Level of downscaling applied to animated thumbnails: they use 1/3 the
 * still-image area cap, which keeps animated WebP file sizes sane.
 */
export const ANIMATED_AREA_DIVISOR = 3

/** Regexp matching the temp-file suffix written by {@link encodeImageFile}. */
const ORPHANED_TEMP_RE = /\.writing-\d+-\d+$/

/**
 * Recursively remove any `.writing-<pid>-<ts>` temp files left behind by a
 * previous process crash. Safe to call fire-and-forget at startup.
 */
export async function cleanOrphanedTempFiles(thumbRoot: string): Promise<void> {
	await removeOrphanedInDir(thumbRoot)
}

async function removeOrphanedInDir(dir: string): Promise<void> {
	let entries: string[]
	try {
		entries = await readdir(dir)
	} catch {
		return
	}
	await Promise.all(
		entries.map(async (entry) => {
			const full = join(dir, entry)
			if (ORPHANED_TEMP_RE.test(entry)) {
				await rm(full, { force: true }).catch(() => {})
			} else {
				await removeOrphanedInDir(full)
			}
		}),
	)
}

export const WEBP_QUALITY = 82
export const PREVIEW_WEBP_QUALITY = 90
export const AVIF_QUALITY = 65
export const PREVIEW_AVIF_QUALITY = 70
/**
 * Level of CPU effort the AVIF encoder spends reducing file size
 * (0 = fastest/largest … 9 = slowest/smallest; sharp's default is 4).
 * Thumbs are cache-once artifacts re-encoded in bulk by the precache
 * sweep, where AVIF encode dominates wall time; effort 2 cuts encode
 * cost substantially for a few percent larger output — measured on the
 * precache bench (see bench/precache.bench.ts).
 */
export const AVIF_EFFORT = 2

export type RenderResult = {
	readonly path: string
	readonly bytes: number
}

export type ImageThumbInput =
	| string
	| Buffer
	| {
			readonly openStream: () => Promise<Readable>
			/**
			 * Byte-range read into the underlying source. Lets the metadata
			 * step read a small header window instead of streaming the
			 * whole entry — libvips full-reads non-seekable input.
			 */
			readonly readRange?: (start: number, end: number) => Promise<Buffer>
	  }

function isReopenableImageStream(input: ImageThumbInput): input is {
	readonly openStream: () => Promise<Readable>
	readonly readRange?: (start: number, end: number) => Promise<Buffer>
} {
	return (
		typeof input === "object" &&
		input !== null &&
		!Buffer.isBuffer(input) &&
		"openStream" in input
	)
}

export type ImageThumbRenderResult = RenderResult & {
	readonly format: "webp" | "avif"
	readonly displayWidth: number
	readonly displayHeight: number
	readonly animated: boolean
}

export type VideoFrameSource = string | Readable

/**
 * Encode an image thumb in a single sharp pipeline: one metadata read,
 * animation detection, resize, and encode. Encodes to the variant's
 * `format`, downgrading an animated source to WebP (sharp cannot encode
 * animated AVIF).
 */
export async function renderImageThumbOnce(opts: {
	readonly input: ImageThumbInput
	readonly resolveDest: (fmt: "webp" | "avif") => string
	/**
	 * The resolved render plan: codec, fit policy, area cap and
	 * per-format qualities. The pipeline is a pure consumer of the
	 * variant — everything that decides the output bytes lives in it.
	 */
	readonly variant: ResolvedImageVariant
	readonly ext?: string
}): Promise<ImageThumbRenderResult> {
	const ext =
		opts.ext ??
		(typeof opts.input === "string" ? extname(opts.input).toLowerCase() : "")
	const { meta, animated } = await readImageMetadata(opts.input, ext)
	const h = meta.pageHeight ?? meta.height
	if (meta.width === undefined || h === undefined) {
		throw new Error("image source is missing dimensions")
	}
	const requested = opts.variant.format
	const format = animated && requested === "avif" ? "webp" : requested
	const area = animated
		? Math.floor(opts.variant.maxArea / ANIMATED_AREA_DIVISOR)
		: opts.variant.maxArea
	const dims =
		opts.variant.fit === "exact"
			? { width: meta.width, height: h }
			: fitInsideArea(meta.width, h, area)
	const destPath = opts.resolveDest(format)
	await mkdir(dirname(destPath), { recursive: true })
	const pipeline = isReopenableImageStream(opts.input)
		? await sharpFromReadable(await opts.input.openStream(), {
				pages: animated ? -1 : 1,
				animated: animated || undefined,
			})
		: sharp(
				opts.input,
				sharpImageInputOpts(opts.input, ext, animated ? -1 : 1, animated),
			)
	const result = await encodeImageFile(
		pipeline,
		destPath,
		{
			// `exact` carries no resize bounds: the encoder writes the
			// source pixels verbatim.
			maxWidth: opts.variant.fit === "exact" ? undefined : dims.width,
			maxHeight: opts.variant.fit === "exact" ? undefined : dims.height,
			quality:
				format === "webp" ? opts.variant.webpQuality : opts.variant.avifQuality,
			animated: animated || undefined,
		},
		format,
	)
	return {
		...result,
		format,
		displayWidth: dims.width,
		displayHeight: dims.height,
		animated,
	}
}

/**
 * Encode `sourcePath` to WebP at `destPath`, sized so that
 * `width × height < maxArea`. Animated sources are kept animated.
 * @throws `Error` from sharp.
 */
export async function renderImageWithArea(
	sourcePath: string,
	destPath: string,
	maxArea: number,
	quality: number,
	animated: boolean,
): Promise<RenderResult> {
	await mkdir(dirname(destPath), { recursive: true })
	return encodeSharpWithArea({
		pipeline: sharp(sourcePath, { animated }),
		destPath,
		maxArea,
		quality,
		format: "webp",
		animated,
	})
}

/**
 * Capture a frame from a file path or readable stream via ffmpeg and
 * encode, sized so that `width × height < maxArea`.
 * @throws `Error` with ffmpeg stderr when ffmpeg exits non-zero.
 */
export async function renderVideoFrame(opts: {
	readonly source: VideoFrameSource
	readonly destPath: string
	readonly ffmpeg: FfmpegPaths
	readonly maxArea: number
	readonly quality: number
	readonly format?: "webp" | "avif"
	readonly timeSeconds?: number
	/** Required when `source` is a stream — ffmpeg cannot infer container from `pipe:0`. */
	readonly ext?: string
}): Promise<RenderResult> {
	return renderFfmpegStill({
		...opts,
		inputFormat:
			opts.ext === undefined ? undefined : extToFfmpegInputFormat(opts.ext),
	})
}

/**
 * Extract an audio file's embedded artwork (ID3 APIC, FLAC PICTURE, MP4
 * `covr`) and encode it as a thumbnail. ffmpeg exposes the artwork as a
 * still video stream, so this rides the same still-frame pipeline as
 * {@link renderVideoFrame} — only the container hint differs.
 * @throws `Error` with ffmpeg stderr when the file carries no artwork.
 */
export async function renderAudioCoverArt(opts: {
	readonly source: VideoFrameSource
	readonly destPath: string
	readonly ffmpeg: FfmpegPaths
	readonly maxArea: number
	readonly quality: number
	readonly format?: "webp" | "avif"
	/** Required when `source` is a stream — ffmpeg cannot infer container from `pipe:0`. */
	readonly ext?: string
}): Promise<RenderResult> {
	return renderFfmpegStill({
		...opts,
		inputFormat:
			opts.ext === undefined ? undefined : extToAudioInputFormat(opts.ext),
	})
}

async function renderFfmpegStill(opts: {
	readonly source: VideoFrameSource
	readonly destPath: string
	readonly ffmpeg: FfmpegPaths
	readonly maxArea: number
	readonly quality: number
	readonly format?: "webp" | "avif"
	readonly timeSeconds?: number
	readonly inputFormat?: string
}): Promise<RenderResult> {
	await mkdir(dirname(opts.destPath), { recursive: true })
	const jpeg = await extractFrameAtTimeJpeg({
		source: opts.source,
		timeSeconds: opts.timeSeconds ?? 0,
		ffmpeg: opts.ffmpeg,
		inputFormat: opts.inputFormat,
	})
	return encodeSharpWithArea({
		pipeline: sharp(jpeg),
		destPath: opts.destPath,
		maxArea: opts.maxArea,
		quality: opts.quality,
		format: opts.format ?? "avif",
		animated: false,
	})
}

type EncodeImageFileOptions = {
	/**
	 * Resize bounds (fit `inside`, never enlarged). When both are
	 * omitted the source pixels are encoded verbatim — the `exact`
	 * variant's transcode-only path.
	 */
	readonly maxWidth?: number
	readonly maxHeight?: number
	readonly quality: number
	/**
	 * When `true`, skip `.rotate()` (sharp's auto-EXIF-orient call which
	 * collapses animated input to a single frame) so the encoded WebP
	 * keeps every page. Animated sources never carry useful EXIF
	 * orientation, so dropping the rotate is safe.
	 */
	readonly animated?: boolean
}

/**
 * Encode a sharp pipeline to `destPath`, sized so that
 * `width × height < maxArea`.
 */
async function encodeSharpWithArea(opts: {
	pipeline: Sharp
	destPath: string
	maxArea: number
	quality: number
	format: "webp" | "avif"
	animated: boolean
}): Promise<RenderResult> {
	const meta = await opts.pipeline.metadata()
	const h = meta.pageHeight ?? meta.height
	const dims =
		meta.width !== undefined && h !== undefined
			? fitInsideArea(meta.width, h, opts.maxArea)
			: undefined
	return encodeImageFile(
		opts.pipeline,
		opts.destPath,
		{
			maxWidth: dims?.width,
			maxHeight: dims?.height,
			quality: opts.quality,
			animated: opts.animated || undefined,
		},
		opts.format,
	)
}

async function encodeImageFile(
	pipeline: Sharp,
	destPath: string,
	opts: EncodeImageFileOptions,
	format: "webp" | "avif",
): Promise<RenderResult> {
	const tmp = `${destPath}.writing-${process.pid}-${Date.now()}`
	try {
		const oriented = opts.animated === true ? pipeline : pipeline.rotate()
		const resized =
			opts.maxWidth === undefined && opts.maxHeight === undefined
				? oriented
				: oriented.resize({
						width: opts.maxWidth,
						height: opts.maxHeight,
						fit: "inside",
						withoutEnlargement: true,
					})
		const encoded =
			format === "webp"
				? resized.webp({ quality: opts.quality })
				: resized.avif({ quality: opts.quality, effort: AVIF_EFFORT })
		const info = await encoded.toFile(tmp)
		await rename(tmp, destPath)
		return { path: destPath, bytes: info.size }
	} catch (err) {
		await rm(tmp, { force: true }).catch(() => {})
		throw err
	}
}

/**
 * Compute target pixel dimensions that keep the aspect ratio while
 * guaranteeing `width × height < maxArea`.
 */
export function fitInsideArea(
	srcWidth: number,
	srcHeight: number,
	maxArea: number,
): { readonly width: number; readonly height: number } {
	const area = srcWidth * srcHeight
	if (area <= maxArea) return { width: srcWidth, height: srcHeight }
	const scale = Math.sqrt(maxArea / area)
	return {
		width: Math.max(1, Math.floor(srcWidth * scale)),
		height: Math.max(1, Math.floor(srcHeight * scale)),
	}
}

function extractFrameAtTimeJpeg(opts: {
	source: VideoFrameSource
	timeSeconds: number
	ffmpeg: FfmpegPaths
	inputFormat?: string
}): Promise<Buffer> {
	if (typeof opts.source === "string") {
		return extractFrameAtTimeJpegFromPath(opts.source, opts)
	}
	return extractFrameAtTimeJpegFromStream(opts.source, opts)
}

function extractFrameAtTimeJpegFromPath(
	sourcePath: string,
	opts: {
		timeSeconds: number
		ffmpeg: FfmpegPaths
	},
): Promise<Buffer> {
	const args = ["-hide_banner", "-loglevel", "error"]
	if (opts.timeSeconds > 0) {
		args.push("-ss", String(opts.timeSeconds))
	}
	args.push("-i", sourcePath)
	args.push(
		"-vf",
		"scale=iw*sar:ih,scale='min(1024,iw)':-2",
		"-frames:v",
		"1",
		"-f",
		"image2",
		"-vcodec",
		"mjpeg",
		"pipe:1",
	)
	return runFfmpegJpegExtract(args, opts.ffmpeg, undefined)
}

function extractFrameAtTimeJpegFromStream(
	source: Readable,
	opts: {
		timeSeconds: number
		ffmpeg: FfmpegPaths
		inputFormat?: string
	},
): Promise<Buffer> {
	if (opts.inputFormat === undefined) {
		return Promise.reject(
			new Error("stream video frame extraction requires an input format hint"),
		)
	}
	const args = ["-hide_banner", "-loglevel", "error"]
	args.push("-probesize", "100M", "-analyzeduration", "100M")
	args.push("-f", opts.inputFormat, "-i", "pipe:0")
	if (opts.timeSeconds > 0) {
		args.push("-ss", String(opts.timeSeconds))
	}
	args.push(
		"-vf",
		"scale=iw*sar:ih,scale='min(1024,iw)':-2",
		"-frames:v",
		"1",
		"-f",
		"image2",
		"-vcodec",
		"mjpeg",
		"pipe:1",
	)
	return runFfmpegJpegExtract(args, opts.ffmpeg, source)
}

function runFfmpegJpegExtract(
	args: string[],
	ffmpeg: FfmpegPaths,
	source: Readable | undefined,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const fromStream = source !== undefined
		const child = spawn(ffmpeg.ffmpeg, args, {
			stdio: fromStream ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
		})
		const stdout = child.stdout
		const stderr = child.stderr
		if (stdout === null || stderr === null) {
			reject(new Error("ffmpeg stdio was not configured"))
			return
		}
		const stdoutChunks: Buffer[] = []
		const stderrChunks: Buffer[] = []
		stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk))
		stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk))
		if (source !== undefined) {
			source.on("error", reject)
			source.pipe(child.stdin!)
			child.stdin?.on("error", () => {})
		}
		child.on("error", reject)
		child.on("close", (code) => {
			if (code !== 0) {
				const msg = Buffer.concat(stderrChunks).toString("utf8").trim()
				reject(new Error(`ffmpeg exited ${code}${msg ? `: ${msg}` : ""}`))
				return
			}
			const out = Buffer.concat(stdoutChunks)
			if (out.length === 0) {
				reject(new Error("ffmpeg produced no output"))
				return
			}
			resolve(out)
		})
	})
}
