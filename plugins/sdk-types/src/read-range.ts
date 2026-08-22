/**
 * Byte range used by every file read across the plugin stack — the
 * server-side `ResourceAPI.readFile` (see `@hoardodile/host`) and the
 * browser-side `PluginRequests.readFile` (see `@hoardodile/sdk-web`) —
 * so the contract lives exactly once. `start` is inclusive (default 0),
 * `end` is exclusive (default end of file). Hosts clamp the range to the
 * file size; a range at or past the end resolves to an empty result.
 */
export type ReadFileRange = {
	readonly start?: number
	readonly end?: number
}
