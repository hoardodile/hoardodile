import { readdir } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import type { PluginProbeCache } from "@hoardodile/host"
import { imageVariantKey } from "@hoardodile/host/hoard"
import {
	imageThumbSource,
	type ThumbInput,
	type WithThumbInputOptions,
	withThumbInput,
} from "@hoardodile/host/media"
import type { FfmpegPaths } from "@hoardodile/host/render"
import {
	AVIF_QUALITY,
	cleanOrphanedTempFiles,
	PREVIEW_AVIF_QUALITY,
	PREVIEW_WEBP_QUALITY,
	renderAudioCoverArt,
	renderImageThumbOnce,
	renderVideoFrame,
	resolveFfmpegPaths,
	WEBP_QUALITY,
} from "@hoardodile/host/render"
import {
	type ImageVariantSpec,
	imageVariantCanonical,
	normalizeImageVariantSpec,
	type ResolvedImageVariant,
} from "@hoardodile/sdk-types/image-variant"
import { IMAGE_EXTS } from "@hoardodile/sdk-types/media-exts"
import { RESOURCE_COVER_MAX_AREA } from "@hoardodile/sdk-types/resource"
import {
	CHARACTER_AVATAR_MAX_AREA,
	CHARACTER_FULLBODY_MAX_AREA,
} from "@hoardodile/shared"
import type { ResPreviewSource } from "src/domain/res/service.ts"
import type { SourceArtifactView } from "src/domain/res/source-view.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"
import type { AdaptiveConcurrency } from "../adaptive-concurrency.ts"
import { createKeyedQueue, type KeyedQueue } from "../queue.ts"
import {
	dispatchMediaKind,
	renderArtifact,
	type ThumbFormat,
	type ThumbResult,
} from "./artifact.ts"
import {
	renderSourceThumb,
	type ThumbSource,
	withSourceThumbInput,
	withViewMediaSource,
} from "./source.ts"

export type {
	ThumbFormat,
	ThumbReady,
	ThumbResult,
	ThumbUnavailable,
} from "./artifact.ts"

export const RESOURCE_LOCAL_COVER_VARIANT = "cover"
export const CHARACTER_AVATAR_VARIANT = "avatar"
export const CHARACTER_FULLBODY_VARIANT = "fullbody"

export type ThumbServiceDeps = {
	readonly paths: StoragePaths
	readonly resources: ResPreviewSource
	/** Max parallel synth jobs. Defaults to 2. Pass an {@link AdaptiveConcurrency} for dynamic scaling. */
	readonly concurrency?: number | AdaptiveConcurrency
	/** Override for tests so they never shell out or touch sharp. */
	readonly ffmpeg?: FfmpegPaths
	/**
	 * Shared probe cache, scoped per (resId, fileVersion) at call time —
	 * the same instance the plugin API uses, so entry sniffing is reused
	 * across hook runs and thumb jobs for one resource version.
	 */
	readonly probeCache?: PluginProbeCache
}

export type ThumbService = {
	getCover(
		id: string,
		/**
		 * When provided, renders the cover from this file instead of
		 * resolving via the content plugin. Used by the HTTP layer when a
		 * permanent cover exists.
		 */
		sourcePath?: string,
	): Promise<ThumbResult>
	getFilePreview(
		id: string,
		filename: string,
		/**
		 * Requested variant; defaults to the standard preview spec
		 * (AVIF, fit inside, the preview area cap).
		 */
		spec?: ImageVariantSpec,
	): Promise<ThumbResult>
	getCharacterThumb(
		id: string,
		variant: "avatar" | "fullbody",
		version: number,
	): Promise<ThumbResult>
	getVideoFrame(
		id: string,
		filename: string,
		timeMs: number,
	): Promise<ThumbResult>
	/**
	 * Expose the queue so tests can assert coalescing. Not part of the
	 * narrow {@link ThumbResult} contract the HTTP layer consumes.
	 */
	readonly queue: KeyedQueue<ThumbResult>
}

const DEFAULT_CONCURRENCY = 2

/** Build a {@link ThumbService} backed by the on-demand queue. */
export function createThumbService(deps: ThumbServiceDeps): ThumbService {
	const ffmpeg = deps.ffmpeg ?? resolveFfmpegPaths()
	const adaptive =
		typeof deps.concurrency === "object" ? deps.concurrency : undefined
	const queue = createKeyedQueue<ThumbResult>({
		concurrency: adaptive ?? deps.concurrency ?? DEFAULT_CONCURRENCY,
		onTaskComplete: adaptive ? (ms) => adaptive.recordDuration(ms) : undefined,
	})

	function thumbInputOpts(
		view: SourceArtifactView,
		id: string,
	): WithThumbInputOptions {
		return deps.probeCache === undefined
			? { label: id }
			: {
					label: id,
					probeCache: deps.probeCache,
					cacheScope: `${id}:${view.fileVersion}`,
				}
	}

	function thumbOptsOf(
		source: ThumbSource,
		id: string,
	): WithThumbInputOptions | undefined {
		return source.kind === "view" ? thumbInputOpts(source.view, id) : undefined
	}

	// Fire-and-forget: remove any temp files left by a previous crash.
	void cleanOrphanedTempFiles(deps.paths.local.root)

	/** The fixed render plan every cover artifact shares. */
	const coverVariant: ResolvedImageVariant = {
		format: "avif",
		fit: "inside",
		maxArea: RESOURCE_COVER_MAX_AREA,
		webpQuality: WEBP_QUALITY,
		avifQuality: AVIF_QUALITY,
	}

	async function renderVideoCoverFrame(
		view: SourceArtifactView,
		relPath: string,
		input: ThumbInput,
		ext: string,
		destPath: string,
		timeSeconds = 0,
	): Promise<void> {
		const renderOpts = {
			ext,
			destPath,
			ffmpeg,
			maxArea: RESOURCE_COVER_MAX_AREA,
			quality: AVIF_QUALITY,
			format: "avif" as const,
			timeSeconds,
		}
		// The seekable gate decides stream vs materialized input (see
		// withViewMediaSource); the cover renderer never needs to know.
		await withViewMediaSource(view, relPath, ext, "video", input, (source) =>
			renderVideoFrame({ ...renderOpts, source }),
		)
	}

	/**
	 * Render an audio file's embedded artwork as the resource cover.
	 * Mirrors the video frame path, including the seekable fallback:
	 * `.m4a` is ISO-BMFF, so its index sits at the end of the file and a
	 * pipe read cannot find it.
	 * @throws `Error` when the file carries no embedded artwork.
	 */
	async function renderAudioCover(
		view: SourceArtifactView,
		relPath: string,
		input: ThumbInput,
		ext: string,
		destPath: string,
	): Promise<void> {
		const renderOpts = {
			ext,
			destPath,
			ffmpeg,
			maxArea: RESOURCE_COVER_MAX_AREA,
			quality: AVIF_QUALITY,
			format: "avif" as const,
		}
		await withViewMediaSource(view, relPath, ext, "audio", input, (source) =>
			renderAudioCoverArt({ ...renderOpts, source }),
		)
	}

	async function getCover(
		id: string,
		sourcePath?: string,
	): Promise<ThumbResult> {
		const resolveDest = (fmt: ThumbFormat) =>
			deps.paths.local.localCover(
				"resource",
				id,
				RESOURCE_LOCAL_COVER_VARIANT,
				fmt,
			)

		return renderArtifact({
			queue,
			resolveDest,
			resolveSource: async () => {
				if (sourcePath !== undefined) {
					// Permanent cover: a bare file in the resource folder —
					// routed through the shared media channel like every
					// other image source (sniffed, seekable-path input).
					return { kind: "path", path: sourcePath }
				}
				const view = await deps.resources.resolveSourceView(id)
				const localCoverFile = await deps.resources.resolveLocalCoverSource(id)
				if (localCoverFile === undefined) return undefined
				return { kind: "view", view, relPath: localCoverFile }
			},
			render: async (source) => {
				// Permanent covers are bare image files: the plain image
				// channel, exactly like the character thumbs.
				if (source.kind === "path") {
					const rendered = await renderSourceThumb(source, {
						resolveDest,
						variant: coverVariant,
					})
					return { kind: "ready", path: rendered.path, format: rendered.format }
				}
				const { view, relPath } = source
				return withSourceThumbInput(
					source,
					"any",
					(input, ext, kind) =>
						dispatchMediaKind<ThumbResult>(
							kind,
							{
								image: async () => {
									const rendered = await renderImageThumbOnce({
										input: imageThumbSource(input),
										ext,
										resolveDest,
										variant: coverVariant,
									})
									return {
										kind: "ready",
										path: rendered.path,
										format: rendered.format,
									}
								},
								video: async () => {
									const destPath = resolveDest("avif")
									await renderVideoCoverFrame(
										view,
										relPath,
										input,
										ext,
										destPath,
									)
									return { kind: "ready", path: destPath, format: "avif" }
								},
								audio: async () => {
									// Audio only has a cover when the file embeds
									// artwork; otherwise the card renders its own
									// audio player instead of a thumbnail.
									const destPath = resolveDest("avif")
									await renderAudioCover(view, relPath, input, ext, destPath)
									return { kind: "ready", path: destPath, format: "avif" }
								},
							},
							() =>
								Promise.resolve({
									kind: "unavailable",
									reason: "placeholder",
								}),
						),
					thumbOptsOf(source, id),
				)
			},
		})
	}

	async function getFilePreview(
		id: string,
		filename: string,
		spec: ImageVariantSpec = {},
	): Promise<ThumbResult> {
		// Every request renders under its own cache identity: the variant
		// key encodes the fully resolved spec, so two specs that render
		// identically share one file and distinct specs never collide.
		const resolved = normalizeImageVariantSpec(spec, {
			avifQuality: PREVIEW_AVIF_QUALITY,
			webpQuality: PREVIEW_WEBP_QUALITY,
		})
		const variantKey = imageVariantKey(imageVariantCanonical(resolved))
		const resolveDest = (fmt: ThumbFormat) =>
			deps.paths.local.resFileVariant(id, filename, variantKey, fmt)

		return renderArtifact({
			queue,
			resolveDest,
			resolveSource: async () => {
				// Live rows resolve through the resource service; a
				// hard-deleted resource (no row) falls back to its
				// `local/trash/` entry so the trash preview keeps
				// rendering derived variants.
				let view: SourceArtifactView
				try {
					view = await deps.resources.resolveSourceView(id)
				} catch {
					const trashed = await deps.resources.resolveTrashedSourceView?.(id)
					if (trashed === undefined) throw new Error("source not found")
					view = trashed
				}
				return { kind: "view", view, relPath: filename }
			},
			render: async (source) => {
				// No extension gate: the channel sniffs the content, so a
				// mislabelled file still previews.
				const rendered = await renderSourceThumb(source, {
					resolveDest,
					variant: resolved,
					thumbOpts: thumbOptsOf(source, id),
				})
				return { kind: "ready", path: rendered.path, format: rendered.format }
			},
		})
	}

	async function getCharacterThumb(
		id: string,
		variant: "avatar" | "fullbody",
		version: number,
	): Promise<ThumbResult> {
		const variantName =
			variant === "avatar"
				? CHARACTER_AVATAR_VARIANT
				: CHARACTER_FULLBODY_VARIANT
		const keyedVariant = `v${version}-${variantName}`
		const resolveDest = (fmt: ThumbFormat) =>
			deps.paths.local.localCover("character", id, keyedVariant, fmt)
		const characterVariant: ResolvedImageVariant = {
			format: "avif",
			fit: "inside",
			maxArea:
				variant === "avatar"
					? CHARACTER_AVATAR_MAX_AREA
					: CHARACTER_FULLBODY_MAX_AREA,
			webpQuality: WEBP_QUALITY,
			avifQuality: AVIF_QUALITY,
		}

		return renderArtifact({
			queue,
			resolveDest,
			resolveSource: async () => {
				const charDir = deps.paths.atVersion(version).character(id)
				const entries = await readdir(charDir).catch(() => [])
				const prefix = `${variant}.`
				const filename = entries.find((n) => {
					const base = basename(n)
					return (
						base.startsWith(prefix) &&
						IMAGE_EXTS.has(extname(base).toLowerCase())
					)
				})
				if (filename === undefined) return undefined
				return { kind: "path", path: join(charDir, filename) }
			},
			render: async (source) => {
				// Through the shared channel: content is sniffed, so the
				// on-disk extension never decides what renders.
				const rendered = await renderSourceThumb(source, {
					resolveDest,
					variant: characterVariant,
				})
				return { kind: "ready", path: rendered.path, format: rendered.format }
			},
		})
	}

	async function getVideoFrame(
		id: string,
		filename: string,
		timeMs: number,
	): Promise<ThumbResult> {
		const destPath = deps.paths.local.resVideoFrame(id, filename, timeMs)

		return renderArtifact({
			queue,
			// Frames always render as avif at one destination; the shell's
			// format scan degenerates to a single stat, which is fine.
			resolveDest: () => destPath,
			resolveSource: async () => {
				const view = await deps.resources.resolveSourceView(id)
				return { kind: "view", view, relPath: filename }
			},
			render: (source) => {
				// Frames always come from a resource view; a non-view
				// source cannot be frames here.
				if (source.kind !== "view") {
					return Promise.resolve({ kind: "unavailable", reason: "placeholder" })
				}
				const { view } = source
				if (timeMs > 0) {
					// Arbitrary timestamps need a seekable source: ffmpeg
					// seeks through the container, so the entry is
					// materialized to the extracted cache first.
					return view.withSeekableEntry(filename, async (path) => {
						await renderVideoFrame({
							source: path,
							destPath,
							ffmpeg,
							maxArea: RESOURCE_COVER_MAX_AREA,
							quality: AVIF_QUALITY,
							format: "avif",
							timeSeconds: timeMs / 1000,
						})
						return { kind: "ready", path: destPath, format: "avif" }
					})
				}
				return withThumbInput(
					view,
					filename,
					"video",
					async (input, ext) => {
						await renderVideoCoverFrame(view, filename, input, ext, destPath, 0)
						return { kind: "ready", path: destPath, format: "avif" }
					},
					thumbOptsOf(source, id),
				)
			},
		})
	}

	return {
		getCover,
		getFilePreview,
		getCharacterThumb,
		getVideoFrame,
		queue,
	}
}
