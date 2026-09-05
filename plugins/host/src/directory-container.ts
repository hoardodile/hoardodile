import { readdir } from "node:fs/promises"
import { join } from "node:path"
import type { Readable } from "node:stream"
import type { ResourceContainer } from "./container.ts"
import { createDirectoryReader, isMissingEntry } from "./directory-reader.ts"
import {
	naturalSort,
	ORDER_MANIFEST_NAME,
	orderEntries,
	parseOrderManifest,
} from "./hoard/order-manifest.ts"

/**
 * A {@link ResourceContainer} over a raw filesystem directory. Used to
 * run plugin hooks against a plain directory — during import, before
 * resources exist, or from the CLI. Reads only; the directory is treated
 * as an immutable snapshot for the container's lifetime.
 */
export function createDirectoryContainer(
	dir: string,
	options: { boundaryRoot?: string } = {},
): ResourceContainer {
	const reader = createDirectoryReader(dir, options.boundaryRoot)
	async function readEntry(relPath: string): Promise<Buffer> {
		const { handle } = await reader.openFile(relPath)
		try {
			return await handle.readFile()
		} finally {
			await handle.close()
		}
	}

	return {
		async listEntries(): Promise<readonly string[]> {
			const out: string[] = []
			async function collect(current: string, prefix: string): Promise<void> {
				const resolved = await reader.entry(current, true)
				const entries = await readdir(resolved.path, { withFileTypes: true })
				await reader.entry(current, true)
				for (const e of entries) {
					if (e.name.startsWith(".")) continue
					if (e.name.includes(".uploading-")) continue
					// Entry names always use `/` separators, mirroring zip
					// entry names, regardless of the platform's separator.
					const rel = prefix ? `${prefix}/${e.name}` : e.name
					if (e.isDirectory()) {
						await collect(join(current, e.name), rel)
					} else if (e.isFile()) {
						out.push(rel)
					}
				}
			}
			try {
				await collect("", "")
			} catch (error) {
				if (!isMissingEntry(error)) throw error
			}
			// An explicit order manifest wins when it validates against
			// this listing; otherwise fall back to the natural name sort.
			let manifest: readonly string[] | undefined
			try {
				manifest = parseOrderManifest(
					(await readEntry(ORDER_MANIFEST_NAME)).toString("utf8"),
				)
			} catch (error) {
				if (!isMissingEntry(error)) throw error
			}
			if (manifest !== undefined) {
				const ordered = orderEntries(manifest, out)
				if (ordered !== undefined) return ordered
			}
			return naturalSort(out)
		},

		readEntry,

		async readEntrySlice(
			relPath: string,
			start: number,
			end: number,
		): Promise<Buffer> {
			const { handle } = await reader.openFile(relPath)
			try {
				const { size } = await handle.stat()
				const clampedStart = Math.min(Math.max(0, start), size)
				const clampedEnd = Math.min(Math.max(clampedStart, end), size)
				const length = Math.max(0, clampedEnd - clampedStart)
				if (length === 0) return Buffer.alloc(0)
				const buf = Buffer.alloc(length)
				await handle.read(buf, 0, length, clampedStart)
				return buf
			} finally {
				await handle.close()
			}
		},

		async openEntryStream(relPath: string): Promise<{
			readonly stream: Readable
			readonly size: number
			readonly mtimeMs?: number
			readonly path?: string
		}> {
			const { handle, info, path } = await reader.openFile(relPath)
			return {
				stream: handle.createReadStream({ autoClose: true }),
				size: info.size,
				mtimeMs: info.mtimeMs,
				path,
			}
		},

		async resolveByteRange(
			relPath: string,
		): Promise<{ readonly size: number } | undefined> {
			try {
				return { size: (await reader.entry(relPath)).info.size }
			} catch (error) {
				if (isMissingEntry(error)) return undefined
				throw error
			}
		},

		async resolveSeekablePath(relPath: string): Promise<string | undefined> {
			try {
				return (await reader.entry(relPath)).path
			} catch (error) {
				if (isMissingEntry(error)) return undefined
				throw error
			}
		},
	}
}

export { resolveSafeImportPath } from "./directory-reader.ts"
