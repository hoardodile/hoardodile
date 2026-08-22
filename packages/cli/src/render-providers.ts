import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"
import type { ResourceAPI } from "@hoardodile/host"
import {
	type ImageVariantQuery,
	imageVariantCanonical,
	normalizeImageVariantSpec,
	parseImageVariantQuery,
} from "@hoardodile/sdk-types/image-variant"
import {
	RESOURCE_COVER_MAX_AREA,
	RESOURCE_PREVIEW_MAX_AREA,
} from "@hoardodile/sdk-types/resource"

/**
 * The workbench's render providers: the same `@hoardodile/host/render`
 * pipeline the server runs, wired to the CLI's resource views. This is
 * what makes file variants (`?size=preview` and the generic
 * `fmt`/`fit`/`area`/`q` parameters), resource covers and the video
 * seek-preview route behave in the workbench exactly as they do in the
 * app.
 *
 * The pipeline is imported lazily because it needs `sharp`, an optional
 * peer a plugin project may not have installed. Loading it on demand
 * keeps `plugin build|run|bench` free of that requirement, and a plugin
 * without sharp still gets the whole dev loop — minus rendered
 * variants, which fall back to the original bytes.
 *
 * Rendered artifacts are cached under the plugin's own directory —
 * never inside the user's storage root, which the dev loop only reads.
 */

export type Rendered = {
	readonly contentType: string
	readonly path: string
}

export type RenderProviders = {
	/**
	 * Render the resource cover (the entry the plugin's `coverLocal`
	 * hook selected). `undefined` when the resource has no cover source
	 * or the render cannot be produced.
	 */
	readonly cover: (resId: string) => Promise<Rendered | undefined>
	readonly preview: (
		resId: string,
		path: string,
		/**
		 * The file route's raw variant query (see
		 * {@link ImageVariantQuery}); `undefined` or empty renders the
		 * default preview variant.
		 */
		variant?: ImageVariantQuery,
	) => Promise<Rendered | undefined>
	readonly frame: (
		resId: string,
		path: string,
		timeMs: number,
	) => Promise<Rendered | undefined>
}

type RenderModule = typeof import("@hoardodile/host/render")

/** Stable, filesystem-safe cache key for a resource entry. */
function cacheKey(resId: string, path: string, suffix = ""): string {
	return createHash("sha256")
		.update(`${resId}\u0000${path}${suffix}`)
		.digest("hex")
		.slice(0, 32)
}

function contentTypeOf(format: "webp" | "avif"): string {
	return format === "webp" ? "image/webp" : "image/avif"
}

export function createRenderProviders(opts: {
	/** Resolve the resource view a render reads from. */
	readonly resolveApi: (resId: string) => Promise<ResourceAPI | undefined>
	/**
	 * Resolve the cover source entry for a resource (the plugin's
	 * `coverLocal` result). When omitted, covers are unavailable.
	 */
	readonly resolveCoverSource?: (resId: string) => Promise<string | undefined>
	/** Cache root, e.g. `<pluginDir>/.hoardodile/cache`. */
	readonly cacheDir: string
}): RenderProviders {
	let renderPromise: Promise<RenderModule | undefined> | undefined

	/**
	 * Load the render pipeline once. A missing `sharp` is a normal
	 * outcome, reported once so the fallback is never a mystery.
	 */
	function loadRender(): Promise<RenderModule | undefined> {
		renderPromise ??= import("@hoardodile/host/render").catch(
			(err: unknown) => {
				console.warn(
					`[hoardodile] preview and frame rendering are unavailable — install "sharp" (and an ffmpeg binary for video) to enable them: ${err instanceof Error ? err.message : String(err)}`,
				)
				return undefined
			},
		)
		return renderPromise
	}

	/**
	 * Read an entry into memory for the renderer. Preview and frame
	 * inputs are single files the user is already looking at, so a whole
	 * read is the simple, honest choice here.
	 */
	async function readEntry(
		api: ResourceAPI,
		path: string,
	): Promise<Uint8Array | undefined> {
		try {
			return await api.readFile(path)
		} catch {
			return undefined
		}
	}

	function cached(base: string): Rendered | undefined {
		for (const format of ["avif", "webp"] as const) {
			const path = `${base}.${format}`
			if (existsSync(path)) return { path, contentType: contentTypeOf(format) }
		}
		return undefined
	}

	async function cover(resId: string): Promise<Rendered | undefined> {
		if (opts.resolveCoverSource === undefined) return undefined
		const source = await opts.resolveCoverSource(resId)
		if (source === undefined) return undefined
		const api = await opts.resolveApi(resId)
		if (api === undefined) return undefined
		const type = await api.sniff(source)
		const kind = type?.kind
		if (kind !== "image" && kind !== "video" && kind !== "audio") {
			return undefined
		}
		const ext = type?.ext ?? extname(source).toLowerCase()
		const base = join(opts.cacheDir, `cover-${cacheKey(resId, source)}`)
		const hit = cached(base)
		if (hit !== undefined) return hit
		const render = await loadRender()
		if (render === undefined) return undefined
		await mkdir(opts.cacheDir, { recursive: true })
		try {
			if (kind === "image") {
				const bytes = await readEntry(api, source)
				if (bytes === undefined) return undefined
				const rendered = await render.renderImageThumbOnce({
					input: Buffer.from(bytes),
					ext,
					resolveDest: (format) => `${base}.${format}`,
					variant: {
						format: "avif",
						fit: "inside",
						maxArea: RESOURCE_COVER_MAX_AREA,
						webpQuality: render.WEBP_QUALITY,
						avifQuality: render.AVIF_QUALITY,
					},
				})
				return {
					path: rendered.path,
					contentType: contentTypeOf(rendered.format),
				}
			}
			// ffmpeg needs a seekable input, so the entry is materialized
			// into the cache first, mirroring the server's seekable gate.
			const sourcePath = join(
				opts.cacheDir,
				`source-${cacheKey(resId, source, "cover")}${ext}`,
			)
			if (!existsSync(sourcePath)) {
				const bytes = await readEntry(api, source)
				if (bytes === undefined) return undefined
				await writeFile(sourcePath, bytes)
			}
			const destPath = `${base}.avif`
			if (kind === "video") {
				await render.renderVideoFrame({
					source: sourcePath,
					destPath,
					ffmpeg: render.resolveFfmpegPaths(),
					maxArea: RESOURCE_COVER_MAX_AREA,
					quality: render.AVIF_QUALITY,
					format: "avif",
					timeSeconds: 0,
					ext,
				})
			} else {
				await render.renderAudioCoverArt({
					source: sourcePath,
					destPath,
					ffmpeg: render.resolveFfmpegPaths(),
					maxArea: RESOURCE_COVER_MAX_AREA,
					quality: render.AVIF_QUALITY,
					format: "avif",
					ext,
				})
			}
			return { path: destPath, contentType: "image/avif" }
		} catch (err) {
			console.warn(
				`[hoardodile] cover render failed for ${source}: ${err instanceof Error ? err.message : String(err)}`,
			)
			return undefined
		}
	}

	async function preview(
		resId: string,
		path: string,
		variant?: ImageVariantQuery,
	): Promise<Rendered | undefined> {
		const api = await opts.resolveApi(resId)
		if (api === undefined) return undefined
		if ((await api.sniff(path))?.kind !== "image") return undefined
		const parsed = parseImageVariantQuery(variant ?? {})
		// The workbench mount only routes variant requests here; anything
		// else (or a malformed query) falls back to the original bytes.
		if (parsed.kind !== "variant") return undefined
		const render = await loadRender()
		if (render === undefined) return undefined
		const resolved = normalizeImageVariantSpec(parsed.spec, {
			avifQuality: render.PREVIEW_AVIF_QUALITY,
			webpQuality: render.PREVIEW_WEBP_QUALITY,
		})
		const base = join(
			opts.cacheDir,
			`preview-${cacheKey(resId, path, imageVariantCanonical(resolved))}`,
		)
		const hit = cached(base)
		if (hit !== undefined) return hit
		const bytes = await readEntry(api, path)
		if (bytes === undefined) return undefined
		await mkdir(opts.cacheDir, { recursive: true })
		try {
			const rendered = await render.renderImageThumbOnce({
				input: Buffer.from(bytes),
				resolveDest: (format) => `${base}.${format}`,
				variant: resolved,
			})
			return {
				path: rendered.path,
				contentType: contentTypeOf(rendered.format),
			}
		} catch (err) {
			console.warn(
				`[hoardodile] preview render failed for ${path}: ${err instanceof Error ? err.message : String(err)}`,
			)
			return undefined
		}
	}

	async function frame(
		resId: string,
		path: string,
		timeMs: number,
	): Promise<Rendered | undefined> {
		const api = await opts.resolveApi(resId)
		if (api === undefined) return undefined
		const type = await api.sniff(path)
		if (type?.kind !== "video") return undefined
		const destPath = join(
			opts.cacheDir,
			`frame-${cacheKey(resId, path, `@${timeMs}`)}.avif`,
		)
		if (existsSync(destPath)) {
			return { path: destPath, contentType: "image/avif" }
		}
		const render = await loadRender()
		if (render === undefined) return undefined
		// ffmpeg needs a seekable input to land on an arbitrary
		// timestamp, so the entry is materialized into the cache first.
		const sourcePath = join(
			opts.cacheDir,
			`source-${cacheKey(resId, path)}${type.ext}`,
		)
		if (!existsSync(sourcePath)) {
			const bytes = await readEntry(api, path)
			if (bytes === undefined) return undefined
			await mkdir(opts.cacheDir, { recursive: true })
			await writeFile(sourcePath, bytes)
		}
		try {
			await render.renderVideoFrame({
				source: sourcePath,
				destPath,
				ffmpeg: render.resolveFfmpegPaths(),
				maxArea: RESOURCE_PREVIEW_MAX_AREA,
				quality: render.PREVIEW_AVIF_QUALITY,
				format: "avif",
				timeSeconds: timeMs / 1000,
				ext: type.ext,
			})
			return { path: destPath, contentType: "image/avif" }
		} catch (err) {
			console.warn(
				`[hoardodile] frame render failed for ${path}@${timeMs}ms: ${err instanceof Error ? err.message : String(err)}`,
			)
			return undefined
		}
	}

	return { cover, preview, frame }
}
