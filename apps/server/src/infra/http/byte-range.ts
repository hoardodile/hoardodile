import { createReadStream, ReadStream, read } from "node:fs"
import { Readable } from "node:stream"
import { err, ok, type Result } from "@hoardodile/sdk-types"

export type ParsedRange = Result<{
	readonly start: number
	readonly end: number
}>
/**
 * Parse a single-range `bytes=start-end` header. Multi-range requests
 * are treated as unsatisfiable; the upstream playback / download
 * clients we care about always ask for a single contiguous range.
 */
export function parseByteRange(header: string, totalSize: number): ParsedRange {
	const value = header.slice("bytes=".length)
	if (value.includes(",")) return err()
	const dash = value.indexOf("-")
	if (dash === -1) return err()
	const startRaw = value.slice(0, dash).trim()
	const endRaw = value.slice(dash + 1).trim()
	if (totalSize === 0) return err()
	if (startRaw.length === 0 && endRaw.length === 0) return err()
	if (startRaw.length === 0) {
		const suffix = Number(endRaw)
		if (!Number.isSafeInteger(suffix) || suffix <= 0) return err()
		const length = Math.min(suffix, totalSize)
		return ok({ start: totalSize - length, end: totalSize - 1 })
	}
	const start = Number(startRaw)
	if (!Number.isSafeInteger(start) || start < 0 || start >= totalSize) {
		return err()
	}
	if (endRaw.length === 0) {
		return ok({ start, end: totalSize - 1 })
	}
	const end = Number(endRaw)
	if (!Number.isSafeInteger(end) || end < start) return err()
	return ok({ start, end: Math.min(end, totalSize - 1) })
}

/** Stream only `[start, end]` (inclusive) of `stream`. */
export function sliceStream(
	stream: Readable,
	start: number,
	end: number,
): Readable {
	if (
		stream instanceof ReadStream &&
		"fd" in stream &&
		typeof stream.fd === "number" &&
		stream.fd >= 0
	) {
		// Reuse the checked descriptor instead of reopening a replaceable pathname.
		const ranged = createReadStream("", {
			fd: stream.fd,
			start,
			end,
			autoClose: true,
			fs: {
				read,
				close(_fd, callback) {
					// Only the original FileHandle stream owns this descriptor.
					stream.destroy()
					callback(null)
				},
			},
		})
		stream.once("error", (error) => ranged.destroy(error))
		return ranged
	}
	const ranged = Readable.from(
		(async function* sliceChunks() {
			let pos = 0
			for await (const chunk of stream) {
				const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
				const chunkStart = pos
				const chunkEnd = pos + bytes.length
				pos = chunkEnd
				if (chunkEnd <= start || chunkStart > end) continue
				const from = Math.max(0, start - chunkStart)
				const to = Math.min(bytes.length, end - chunkStart + 1)
				yield bytes.subarray(from, to)
				if (chunkEnd > end) break
			}
		})(),
	)
	ranged.once("close", () => stream.destroy())
	return ranged
}
