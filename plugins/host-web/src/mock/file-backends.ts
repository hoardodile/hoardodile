import type { ReadFileRange } from "@hoardodile/sdk-types"

/** Shared read-range contract; defined once in `@hoardodile/sdk-types`. */
export type { ReadFileRange } from "@hoardodile/sdk-types"

/**
 * File backends for the offline mock host: the plugin's `listFiles` and
 * `readFile` requests resolve against this interface, so a mock can be
 * pointed at an in-memory map, a real directory (Node), or a read-only
 * HTTP mount (workbench) without changing the host.
 */
export type MockFileBackend = {
	readonly listFiles: (resId: string) => Promise<readonly string[]>
	readonly readFile: (
		resId: string,
		path: string,
		range?: ReadFileRange,
	) => Promise<ArrayBuffer>
	readonly statFile: (
		resId: string,
		path: string,
	) => Promise<{ readonly sizeBytes: number } | undefined>
	/**
	 * The rows the plugin's own `listFiles` hook produced, when the
	 * backend can obtain them (the workbench reads them from a sandboxed
	 * hook snapshot). In production the host answers `listFiles` with
	 * exactly these plugin-shaped entries; returning `undefined` falls
	 * back to generic `{filename, ext, sizeBytes}` rows.
	 */
	readonly listFileEntries?: (
		resId: string,
	) => Promise<readonly unknown[] | undefined>
}

/** In-memory file map backend for unit tests. `resId` is ignored. */
export function createInMemoryFileBackend(
	files: Readonly<Record<string, string | Uint8Array>> = {},
): MockFileBackend {
	return {
		async listFiles() {
			return Object.keys(files)
		},
		async readFile(_resId, path, range) {
			const content = files[path]
			if (content === undefined) {
				throw new Error(`mock file backend has no entry ${path}`)
			}
			const bytes =
				typeof content === "string"
					? new TextEncoder().encode(content)
					: content
			// Mirrors host semantics: the range is clamped to the content
			// size; a start at or past the end resolves to an empty result.
			if (range === undefined) return bytes.slice().buffer
			const start = Math.max(0, range.start ?? 0)
			const end = Math.min(range.end ?? bytes.length, bytes.length)
			return bytes.slice(start, end).buffer
		},
		async statFile(_resId, path) {
			const content = files[path]
			if (content === undefined) return undefined
			const bytes =
				typeof content === "string"
					? new TextEncoder().encode(content)
					: content
			return { sizeBytes: bytes.byteLength }
		},
	}
}
