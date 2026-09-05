import { createWriteStream, readdirSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import yazl from "yazl"

/**
 * On-the-fly zip exports. Resource sources are stored as bare files on
 * disk — nothing is packed at commit time; this module streams STORED
 * zip bytes straight to the consumer without a staging file.
 */

/**
 * A logical zip entry whose bytes are produced on demand. Streams are
 * read once, in order, when the output is consumed.
 */
export type ZipStreamEntry = {
	readonly name: string
	readonly size: number
	readonly openStream: () => Readable
}

/**
 * Stream a STORED zip from an ordered list of logical entries. Used by
 * the HTTP layer for exports (resource source packs, bulk downloads)
 * without a staging file on disk. Zero-length entries are packed as
 * empty buffers.
 */
export function streamStoredZip(entries: readonly ZipStreamEntry[]) {
	const zip = new yazl.ZipFile()
	const output = zip.outputStream
	if (!(output instanceof Readable))
		throw new Error("ZIP output must be a Node readable stream")
	const streams: Readable[] = []
	zip.on("error", (error: Error) => output.destroy(error))
	output.once("close", () => {
		for (const stream of streams) stream.destroy()
	})
	for (const entry of entries) {
		if (entry.size === 0) {
			zip.addBuffer(Buffer.alloc(0), entry.name, { compress: false })
			continue
		}
		const stream = entry.openStream()
		streams.push(stream)
		stream.once("error", (error) => output.destroy(error))
		zip.addReadStream(stream, entry.name, {
			compress: false,
			size: entry.size,
		})
	}
	zip.end()
	return output
}

/**
 * Pack the *contents* of `srcDir` (its entries at the archive root) into
 * a deflated zip written to `zipPath`. Entry names use forward slashes,
 * the file order is sorted by relative path, and the output is streamed
 * to disk — deterministic on every platform, memory-bounded regardless
 * of dist size. The canonical packer for project-internal zips (the
 * plugin release artifact via the CLI); resource exports use
 * {@link streamStoredZip} instead.
 */
export async function packZipDirectory(
	srcDir: string,
	zipPath: string,
): Promise<void> {
	const root = resolve(srcDir)
	const files = listFilesSorted(root)
	const zip = new yazl.ZipFile()
	for (const abs of files) {
		// yazl wants metadata names with forward slashes; the local-path
		// basename order is deterministic thanks to listFilesSorted.
		const rel = abs
			.slice(root.length + 1)
			.split(sep)
			.join("/")
		zip.addFile(abs, rel, { compress: true })
	}
	zip.end()
	await pipeline(zip.outputStream, createWriteStream(resolve(zipPath)))
}

/** Every regular file under `root`, sorted by relative path (recursive). */
function listFilesSorted(root: string): string[] {
	const out: string[] = []
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const abs = join(dir, entry.name)
			if (entry.isDirectory()) {
				walk(abs)
				continue
			}
			if (!entry.isFile()) continue
			out.push(abs)
		}
	}
	walk(root)
	return out.sort()
}
