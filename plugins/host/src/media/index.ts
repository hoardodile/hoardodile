/**
 * Media pipeline helpers: entry-to-render-input dispatch, the
 * streamable-vs-materialized source gate, and the cache/queue render
 * gate. Shared by the server's thumbnail service and cover-meta probes
 * so both paths agree on how a zip entry becomes a renderable source.
 */

export type { KeyedTaskQueue } from "./render-cache.ts"
export { withCacheAndQueue } from "./render-cache.ts"
export { withMediaSource } from "./seekable.ts"
export type { ThumbInput, WithThumbInputOptions } from "./thumb-input.ts"
export {
	ffmpegThumbSource,
	imageThumbSource,
	withThumbInput,
} from "./thumb-input.ts"
