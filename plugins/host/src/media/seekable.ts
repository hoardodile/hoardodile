import type { Readable } from "node:stream"
import { ffmpegThumbSource, type ThumbInput } from "./thumb-input.ts"

/**
 * Run a media pipeline over an entry, materializing it to a seekable
 * path first when the container format needs seeking — ISO-BMFF
 * (.mp4/.mov/.m4v/.m4a) keeps its moov index at the end of the file,
 * unreachable from a forward-only pipe — or when the stream attempt
 * fails for another reason.
 *
 * One implementation shared by the thumbnail pipeline and the cover-meta
 * probes, so the "streamable vs materialize" split can never diverge
 * between the two paths again.
 */
export async function withMediaSource<T>(opts: {
	readonly relPath: string
	readonly ext: string
	readonly input: ThumbInput
	/** Extensions whose container is seekable from a forward-only pipe. */
	readonly streamableExts: ReadonlySet<string>
	/** Materialize `relPath` to a seekable on-disk path. */
	readonly materialize: (relPath: string) => Promise<string>
	readonly run: (source: string | Readable) => Promise<T>
}): Promise<T> {
	const { ext, input, streamableExts, materialize, relPath, run } = opts
	if (input.kind === "stream" && !streamableExts.has(ext)) {
		return run(await materialize(relPath))
	}
	try {
		return await run(await ffmpegThumbSource(input))
	} catch (streamErr) {
		if (input.kind !== "stream") throw streamErr
		return run(await materialize(relPath))
	}
}
