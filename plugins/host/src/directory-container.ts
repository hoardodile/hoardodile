import { createReadStream } from "node:fs"
import { open, readdir, stat } from "node:fs/promises"
import { isAbsolute, join, normalize, resolve, sep } from "node:path"
import type { Readable } from "node:stream"
import type { ResourceContainer } from "./container.ts"
import {
	naturalSort,
	orderEntries,
	readOrderManifest,
} from "./hoard/order-manifest.ts"

/**
 * A {@link ResourceContainer} over a raw filesystem directory. Used to
 * run plugin hooks against a plain directory — during import, before
 * resources exist, or from the CLI. Reads only; the directory is treated
 * as an immutable snapshot for the container's lifetime.
 */
export function createDirectoryContainer(dir: string): ResourceContainer {
	async function resolvePath(relPath: string): Promise<string> {
		return resolveSafeImportPath(dir, relPath)
	}

	return {
		async listEntries(): Promise<readonly string[]> {
			const out: string[] = []
			async function collect(current: string, prefix: string): Promise<void> {
				const entries = await readdir(join(dir, current), {
					withFileTypes: true,
				}).catch(() => [] as readonly never[])
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
			await collect(".", "")
			// An explicit order manifest wins when it validates against
			// this listing; otherwise fall back to the natural name sort.
			const manifest = await readOrderManifest(dir)
			if (manifest !== undefined) {
				const ordered = orderEntries(manifest, out)
				if (ordered !== undefined) return ordered
			}
			return naturalSort(out)
		},

		async readEntry(relPath: string): Promise<Buffer> {
			const safe = await resolvePath(relPath)
			const handle = await open(safe, "r")
			try {
				return await handle.readFile()
			} finally {
				await handle.close()
			}
		},

		async readEntrySlice(
			relPath: string,
			start: number,
			end: number,
		): Promise<Buffer> {
			const safe = await resolvePath(relPath)
			const handle = await open(safe, "r")
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
			const safe = await resolvePath(relPath)
			const info = await stat(safe)
			return {
				stream: createReadStream(safe),
				size: info.size,
				mtimeMs: info.mtimeMs,
				path: safe,
			}
		},

		async resolveByteRange(
			relPath: string,
		): Promise<{ readonly size: number } | undefined> {
			const safe = await resolvePath(relPath)
			const info = await stat(safe).catch(() => undefined)
			return info === undefined ? undefined : { size: info.size }
		},

		async resolveSeekablePath(relPath: string): Promise<string | undefined> {
			const safe = await resolvePath(relPath)
			const info = await stat(safe).catch(() => undefined)
			return info?.isFile() === true ? safe : undefined
		},
	}
}

/**
 * Resolve a plugin-supplied relative path against an import directory,
 * rejecting attempts to escape the directory or use absolute paths.
 */
export function resolveSafeImportPath(dir: string, relPath: string): string {
	if (relPath.length === 0) {
		throw new Error("path is empty")
	}
	if (relPath.includes("\0")) {
		throw new Error("path contains null byte")
	}
	if (isAbsolute(relPath)) {
		throw new Error("absolute paths are not allowed")
	}
	const normalized = normalize(relPath)
	if (normalized.startsWith("..") || normalized === "..") {
		throw new Error("path escapes import directory")
	}
	const root = resolve(dir)
	const candidate = resolve(root, normalized)
	if (candidate !== root && !candidate.startsWith(root + sep)) {
		throw new Error("path escapes import directory")
	}
	return candidate
}
