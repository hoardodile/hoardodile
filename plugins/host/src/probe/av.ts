import type { Readable } from "node:stream"
import type { ProbeResult } from "@hoardodile/sdk-types"

import { audioInfoFromPayload } from "./audio.ts"
import {
	type FfprobePayload,
	type FfprobeStream,
	getFfprobePath,
	runFfprobeJson,
} from "./ffprobe.ts"
import { videoMetaFromPayload } from "./video.ts"

/**
 * The unified audio/video probe behind `ResourceAPI.probe`: one ffprobe
 * pass answers both "which family is this" and "what are its
 * parameters", the way ffprobe itself reports media (`format` plus a
 * `streams` array) instead of asking the caller to guess the family
 * first.
 *
 * Container formats that carry either kind (Ogg, Matroska, ISO-BMFF)
 * are settled here: the stream layout decides, not the extension and
 * not the container MIME.
 */

export type AvProbeOptions = {
	/** MIME type from content sniffing; carried into the result. */
	readonly mime: string
	/**
	 * ffmpeg `-f` container name. Required for stream sources (a pipe
	 * has no filename for ffprobe to key off); ignored for paths.
	 */
	readonly inputFormat?: string
}

/**
 * True for the still image ffmpeg exposes as a video stream: ID3 APIC
 * frames, FLAC PICTURE blocks and MP4 `covr` atoms all surface this
 * way, and none of them make the file a video.
 */
function isAttachedPicture(stream: FfprobeStream): boolean {
	const disposition = stream.disposition
	if (typeof disposition !== "object" || disposition === null) return false
	return (disposition as Record<string, unknown>).attached_pic === 1
}

/**
 * Classify an ffprobe payload into a {@link ProbeResult}. A real video
 * stream wins; otherwise an audio stream decides; a payload with
 * neither is a decode failure.
 */
export function avResultFromPayload(
	payload: FfprobePayload,
	mime: string,
): ProbeResult {
	const streams = payload.streams ?? []
	const hasVideo = streams.some(
		(stream) => stream.codec_type === "video" && !isAttachedPicture(stream),
	)
	if (hasVideo) {
		return { kind: "video", mime, ...videoMetaFromPayload(payload) }
	}
	const audio = audioInfoFromPayload(payload)
	if (audio !== undefined) return { kind: "audio", mime, ...audio }
	return { kind: "unknown", reason: "failed" }
}

/**
 * Probe an audio/video source with ffprobe. Never rejects: a missing
 * binary, an unreadable container or a source ffprobe cannot demux all
 * resolve to `{ kind: "unknown", reason: "failed" }`.
 */
export async function probeAvMedia(
	source: string | Readable,
	opts: AvProbeOptions,
): Promise<ProbeResult> {
	try {
		const inputFormat =
			typeof source === "string" ? undefined : opts.inputFormat
		const payload = await runFfprobeJson(source, getFfprobePath(), inputFormat)
		return avResultFromPayload(payload, opts.mime)
	} catch {
		return { kind: "unknown", reason: "failed" }
	}
}
