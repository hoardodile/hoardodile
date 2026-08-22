import type { Readable } from "node:stream"
import type { VideoInfo } from "../types.ts"
import {
	type FfprobePayload,
	ffprobeDurationMs,
	getFfprobePath,
	parseFfprobePayload,
	runFfprobeJson,
} from "./ffprobe.ts"

/**
 * ffmpeg `-f` container name for piped zip entry bytes (no filename hint).
 */
const FFMPEG_INPUT_FORMAT: Readonly<Record<string, string>> = {
	".mp4": "mp4",
	".m4v": "mp4",
	".webm": "webm",
	".mov": "mov",
	".mkv": "matroska",
	".avi": "avi",
}

/** Resolve an extension to its ffmpeg `-f` container name, or `undefined` for unknown extensions. */
export function extToFfmpegInputFormat(ext: string): string | undefined {
	return FFMPEG_INPUT_FORMAT[ext.toLowerCase()]
}

/**
 * Video probing via ffprobe (see `ffprobe.ts` for path resolution and the
 * process plumbing).
 */

/**
 * Source-media metadata derived by ffprobe - pixel dimensions of the first
 * video stream and the playable duration in milliseconds. Any field can be
 * absent when ffprobe declines to report it (corrupt header, missing
 * container metadata). Callers persist whichever fields are populated.
 */
export type ProbedVideoMeta = {
	readonly width?: number
	readonly height?: number
	readonly durationMs?: number
}

/**
 * Run `ffprobe` against `source` and extract width, height and duration.
 *
 * @throws `Error` with stderr when ffprobe exits non-zero or emits no JSON.
 */
export async function probeVideoMeta(
	source: string | Readable,
	ffprobePath: string,
	inputFormat?: string,
): Promise<ProbedVideoMeta> {
	return videoMetaFromPayload(
		await runFfprobeJson(source, ffprobePath, inputFormat),
	)
}

/**
 * Pure parser; broken out so callers and tests can hit it without spawning
 * ffprobe. Returns only the fields that survive type narrowing - partial
 * payloads are normal for malformed media and we prefer surfacing what we
 * have over rejecting the whole probe.
 */
export function parseFfprobeJson(json: string): ProbedVideoMeta {
	return videoMetaFromPayload(parseFfprobePayload(json))
}

export function videoMetaFromPayload(payload: FfprobePayload): ProbedVideoMeta {
	const result: { width?: number; height?: number; durationMs?: number } = {}
	const videoStream = payload.streams?.find((s) => s.codec_type === "video")
	if (videoStream !== undefined) {
		if (typeof videoStream.width === "number" && videoStream.width > 0) {
			result.width = Math.round(videoStream.width)
		}
		if (typeof videoStream.height === "number" && videoStream.height > 0) {
			result.height = Math.round(videoStream.height)
		}
	}
	const durationMs = ffprobeDurationMs(payload.format)
	if (durationMs !== undefined) result.durationMs = durationMs
	return result
}

/**
 * Probe a video stream or path with ffprobe and return its pixel
 * dimensions and duration. Probe failures return `undefined` so callers
 * can treat "not yet probed" and "probe failed" the same way.
 */
export async function probeVideo(
	source: string | Readable,
	extHint?: string,
): Promise<VideoInfo | undefined> {
	try {
		const inputFormat =
			typeof source === "string" || extHint === undefined
				? undefined
				: extToFfmpegInputFormat(extHint)
		const probed = await probeVideoMeta(source, getFfprobePath(), inputFormat)
		if (
			probed.width === undefined &&
			probed.height === undefined &&
			probed.durationMs === undefined
		) {
			return undefined
		}
		return {
			width: probed.width,
			height: probed.height,
			durationMs: probed.durationMs,
		}
	} catch {
		return undefined
	}
}
