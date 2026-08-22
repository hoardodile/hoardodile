/**
 * The thumbnail/preview render pipeline: sharp for images, ffmpeg for
 * video frames and embedded audio artwork. It lives in the host — next
 * to the probes it shares a sharp instance with — so every consumer
 * renders identically: the server's thumb service in production, and
 * `hoardodile plugin dev` when it serves preview variants and seek
 * frames to the workbench.
 *
 * sharp is a required peer here (unlike probing, rendering cannot
 * degrade); ffmpeg/ffprobe binaries are resolved lazily by `ffmpeg.ts`.
 */

export type { FfmpegPaths } from "./ffmpeg.ts"
export { resolveFfmpegPaths } from "./ffmpeg.ts"
export type {
	ImageThumbInput,
	ImageThumbRenderResult,
	RenderResult,
	VideoFrameSource,
} from "./pipeline.ts"
export {
	ANIMATED_AREA_DIVISOR,
	AVIF_EFFORT,
	AVIF_QUALITY,
	cleanOrphanedTempFiles,
	fitInsideArea,
	PREVIEW_AVIF_QUALITY,
	PREVIEW_WEBP_QUALITY,
	renderAudioCoverArt,
	renderImageThumbOnce,
	renderImageWithArea,
	renderVideoFrame,
	WEBP_QUALITY,
} from "./pipeline.ts"
