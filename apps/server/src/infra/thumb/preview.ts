import { readdir, unlink } from "node:fs/promises"
import { join } from "node:path"
import { ffmpegThumbSource, imageThumbSource } from "@hoardodile/host/media"
import type { FfmpegPaths } from "@hoardodile/host/render"
import {
	AVIF_QUALITY,
	renderImageThumbOnce,
	renderVideoFrame,
	WEBP_QUALITY,
} from "@hoardodile/host/render"
import type { ResolvedImageVariant } from "@hoardodile/sdk-types/image-variant"
import { dispatchMediaKind } from "./artifact.ts"
import { withSourceThumbInput } from "./source.ts"

/** Max pixel area for upload preview thumbnails (300 × 300). */
export const UPLOAD_PREVIEW_MAX_AREA = 90_000

/** Directory holding cached staged-file previews under a tmp base. */
export function uploadPreviewCacheDir(tmpBase: string): string {
	return join(tmpBase, "upload-previews")
}

/**
 * Remove the cached previews of a staged file that is being discarded.
 * Best-effort: the boot-time tmp sweep reclaims leftovers.
 */
export async function removeStagedPreviewCache(
	tmpBase: string,
	fileId: string,
): Promise<void> {
	const cacheDir = uploadPreviewCacheDir(tmpBase)
	const names = await readdir(cacheDir).catch(() => [])
	await Promise.all(
		names
			.filter((n) => n.startsWith(`${fileId}.`))
			.map((n) => unlink(join(cacheDir, n)).catch(() => {})),
	)
}

export type PreviewRenderResult = {
	readonly path: string
	readonly contentType: string
}

/**
 * Generate a downscaled preview image from a source file path.
 *
 * Goes through the shared media channel: the content is sniffed (no
 * extension gate), and the render follows the sniffed kind:
 *
 * - Still images → AVIF
 * - Animated images → WebP (keeps animation)
 * - Video → AVIF frame at 0s
 *
 * @param sourcePath Absolute path to the source file.
 * @param destPathBase Absolute base path for the output (extension will be appended).
 * @param ffmpeg Resolved ffmpeg paths.
 * @returns Path to the generated preview and its Content-Type.
 * @throws Error when the file type is unsupported or rendering fails.
 */
export async function generateUploadPreview(
	sourcePath: string,
	destPathBase: string,
	ffmpeg: FfmpegPaths,
): Promise<PreviewRenderResult> {
	/** The fixed render plan every staged-file preview shares. */
	const previewVariant: ResolvedImageVariant = {
		format: "avif",
		fit: "inside",
		maxArea: UPLOAD_PREVIEW_MAX_AREA,
		webpQuality: WEBP_QUALITY,
		avifQuality: AVIF_QUALITY,
	}

	return withSourceThumbInput(
		{ kind: "path", path: sourcePath },
		"any",
		(input, ext, kind) =>
			dispatchMediaKind<PreviewRenderResult>(
				kind,
				{
					video: async () => {
						const result = await renderVideoFrame({
							source: await ffmpegThumbSource(input),
							destPath: `${destPathBase}.avif`,
							ffmpeg,
							maxArea: UPLOAD_PREVIEW_MAX_AREA,
							quality: AVIF_QUALITY,
							format: "avif",
							timeSeconds: 0,
						})
						return { path: result.path, contentType: "image/avif" }
					},
					image: async () => {
						const rendered = await renderImageThumbOnce({
							input: imageThumbSource(input),
							ext,
							resolveDest: (fmt) => `${destPathBase}.${fmt}`,
							variant: previewVariant,
						})
						return {
							path: rendered.path,
							contentType:
								rendered.format === "webp" ? "image/webp" : "image/avif",
						}
					},
				},
				async () => {
					throw new Error(`unsupported file type: ${ext || "unknown"}`)
				},
			),
	)
}
