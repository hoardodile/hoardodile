/**
 * Probe implementations for the {@link ResourceAPI} builder. Consumed by
 * the server's plugin wiring and the CLI's bench — the same probing code
 * on both sides keeps "test path = production path". sharp and ffprobe
 * are optional peers loaded lazily; see `image.ts` / `video.ts` /
 * `audio.ts`.
 */

import { probeAvMedia } from "./av.ts"
import { probeImageSource } from "./image.ts"

export {
	audioInfoFromPayload,
	extToAudioInputFormat,
	parseFfprobeAudioJson,
	probeAudio,
} from "./audio.ts"
export type { AvProbeOptions } from "./av.ts"
export { avResultFromPayload, probeAvMedia } from "./av.ts"
export { resolveFfprobePath } from "./ffprobe.ts"
export type { ImageMetadataInput, ImageSourceProbe } from "./image.ts"
export {
	isAnimatedCandidateExt,
	loadSharp,
	needsFullAnimationScan,
	PROBE_HEADER_BYTES,
	probeAnimatedImage,
	probeImage,
	probeImageSource,
	readImageMetadata,
	sharpFromReadable,
	sharpImageInputOpts,
	THUMB_BUFFER_MAX_BYTES,
} from "./image.ts"
export { SNIFF_HEADER_BYTES, sniffBytes } from "./sniff.ts"
export type { ProbedVideoMeta } from "./video.ts"
export {
	extToFfmpegInputFormat,
	parseFfprobeJson,
	probeVideo,
	probeVideoMeta,
} from "./video.ts"

/**
 * The host's real probe implementations, shaped for
 * `createPluginResourceAPI({ view, ...mediaProbes })`. Every consumer
 * (server import path, trash fallback, CLI) spreads this same object,
 * so "what you test is what runs in production" holds by construction
 * instead of by three copies of the same wiring.
 */
export const mediaProbes = {
	probeImage: probeImageSource,
	probeAv: probeAvMedia,
} as const
