import type { Readable } from "node:stream"

/**
 * Read-only view over a resource's source data, regardless of storage
 * shape — a zip archive, a raw directory, or an in-memory fixture. The
 * {@link ResourceAPI} builder consumes this interface, so every backend
 * (fixture / directory / zip / the server's artifact view) behaves
 * identically behind a plugin hook.
 *
 * `relPath` values are entry names as they appear in the container (may
 * contain `/`). Containers are immutable for the lifetime of a build:
 * the server's per-version archives never change, and the directory
 * container documents reads as snapshot-only.
 */
export type ResourceContainer = {
	/** List every entry name in the container. Always flat. */
	readonly listEntries: () => Promise<readonly string[]>
	/** Read `relPath` in full. Throws when the entry does not exist. */
	readonly readEntry: (relPath: string) => Promise<Buffer>
	/**
	 * Read the byte range `[start, end)` of `relPath` (`end` exclusive).
	 * The range is clamped to the entry size; an out-of-range start
	 * resolves to an empty buffer.
	 */
	readonly readEntrySlice: (
		relPath: string,
		start: number,
		end: number,
	) => Promise<Buffer>
	/**
	 * Stream entry bytes without buffering the whole entry. `path` is
	 * the absolute on-disk file backing a literal entry, when there is
	 * one — consumers serve ranges through `createReadStream(path,
	 * {start, end})` windows instead of draining + discarding the
	 * stream's prefix.
	 */
	readonly openEntryStream: (relPath: string) => Promise<{
		readonly stream: Readable
		readonly size: number
		/** Modification time of the underlying file, when known. */
		readonly mtimeMs?: number
		/** Absolute path of the backing file, when literal and seekable. */
		readonly path?: string
	}>
	/**
	 * Resolve `relPath` to its byte length. Returns `undefined` when the
	 * entry does not exist (the caller decides how to report that).
	 */
	readonly resolveByteRange: (
		relPath: string,
	) => Promise<{ readonly size: number } | undefined>
	/**
	 * Optional capability: resolve `relPath` to an absolute on-disk path
	 * when its bytes can be read as a seekable file (no extraction, no
	 * decompression). Consumers like the thumbnail pipeline hand such
	 * paths straight to ffmpeg/libvips instead of piping streams.
	 * Returns `undefined` when the container cannot provide one.
	 */
	readonly resolveSeekablePath?: (
		relPath: string,
	) => Promise<string | undefined>
}
