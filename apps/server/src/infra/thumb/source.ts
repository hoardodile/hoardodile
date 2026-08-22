import { basename, dirname } from "node:path"
import type { Readable } from "node:stream"
import { createDirectoryContainer } from "@hoardodile/host"
import {
	imageThumbSource,
	type ThumbInput,
	type WithThumbInputOptions,
	withMediaSource,
	withThumbInput,
} from "@hoardodile/host/media"
import { renderImageThumbOnce } from "@hoardodile/host/render"
import type { ResolvedImageVariant } from "@hoardodile/sdk-types/image-variant"
import {
	type MediaKind,
	STREAMABLE_AUDIO_EXTS,
	STREAMABLE_VIDEO_EXTS,
} from "@hoardodile/sdk-types/media-exts"
import type { SourceArtifactView } from "src/domain/res/source-view.ts"

/**
 * A renderable image source. Every thumbnail-producing feature —
 * covers, avatars/fullbody, per-file previews, upload previews — funnels
 * through this one abstraction so content is always sniffed and
 * dispatched by the same host media pipeline (buffer / stream /
 * seekable path), regardless of whether it lives behind a resource
 * view or as a bare absolute path.
 */
export type ThumbSource =
	| {
			readonly kind: "view"
			readonly view: SourceArtifactView
			readonly relPath: string
	  }
	| { readonly kind: "path"; readonly path: string }

/**
 * Run a thumb pipeline over any {@link ThumbSource}. View sources go
 * through the artifact view directly; bare paths are wrapped in a
 * directory container so sniffing, input dispatch and the seekable-path
 * fast lane are exactly the ones every other consumer uses.
 */
export function withSourceThumbInput<T>(
	source: ThumbSource,
	expected: MediaKind | "any",
	fn: (input: ThumbInput, ext: string, kind: MediaKind) => Promise<T>,
	opts?: WithThumbInputOptions,
): Promise<T> {
	if (source.kind === "view") {
		return withThumbInput(source.view, source.relPath, expected, fn, opts)
	}
	const container = createDirectoryContainer(dirname(source.path))
	return withThumbInput(container, basename(source.path), expected, fn, opts)
}

export type RenderedThumb = {
	readonly path: string
	/** Image format actually written — "avif", or "webp" for animated sources. */
	readonly format: "webp" | "avif"
}

/**
 * Render a downscaled image thumb from any {@link ThumbSource}: the
 * standard composition of the media channel with the sharp pipeline.
 * The variant is the whole render plan — the channel only supplies
 * the input.
 */
export async function renderSourceThumb(
	source: ThumbSource,
	opts: {
		readonly resolveDest: (fmt: "webp" | "avif") => string
		readonly variant: ResolvedImageVariant
		readonly thumbOpts?: WithThumbInputOptions
	},
): Promise<RenderedThumb> {
	return withSourceThumbInput(
		source,
		"image",
		(input, ext) =>
			renderImageThumbOnce({
				input: imageThumbSource(input),
				ext,
				resolveDest: opts.resolveDest,
				variant: opts.variant,
			}),
		opts.thumbOpts,
	)
}

/**
 * Run a video/audio media job over a view entry with the shared
 * seekable gate: streamable containers (WebM etc.) feed `run` straight
 * from the pipe, while seek-dependent containers (ISO-BMFF: `.mp4`,
 * `.mov`, `.m4v`, `.m4a` — the moov index sits at the end of the file)
 * are materialized to the extracted cache first, and any other stream
 * failure retries materialized. `kind` selects the streamable extension
 * set. Used by both the thumb renderers and the cover probes, so the
 * stream-vs-materialize rule lives in one place.
 */
export async function withViewMediaSource<T>(
	view: SourceArtifactView,
	relPath: string,
	ext: string,
	kind: "video" | "audio",
	input: ThumbInput,
	run: (source: string | Readable) => Promise<T>,
): Promise<T> {
	return withMediaSource({
		relPath,
		ext,
		input,
		streamableExts:
			kind === "video" ? STREAMABLE_VIDEO_EXTS : STREAMABLE_AUDIO_EXTS,
		materialize: (p) => view.withSeekableEntry(p, async (path) => path),
		run,
	})
}
