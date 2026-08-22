import type { Readable } from "node:stream"
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
	for (const entry of entries) {
		if (entry.size === 0) {
			zip.addBuffer(Buffer.alloc(0), entry.name, { compress: false })
			continue
		}
		zip.addReadStream(entry.openStream(), entry.name, {
			compress: false,
			size: entry.size,
		})
	}
	zip.end()
	return zip.outputStream
}
