import { createReadStream } from "node:fs"
import type { Readable } from "node:stream"
import type { FastifyReply } from "fastify"
import { parseByteRange, sliceStream } from "./byte-range.ts"
import { sendJson } from "./utils.ts"

/**
 * A logical file's bytes: either an absolute on-disk byte window (a
 * bare resource file) or a stream with its content length (a virtual
 * `outer!inner` entry's decompressed bytes).
 */
export type ByteRangeSource =
	| {
			readonly openStream: () => Promise<Readable>
			/** Logical content length. */
			readonly size: number
	  }
	| {
			readonly path: string
			/** Inclusive absolute start offset inside `path`. */
			readonly start: number
			/** Inclusive absolute end offset inside `path`. */
			readonly end: number
			/** Logical content length (`end - start + 1`). */
			readonly size: number
	  }

/**
 * Stream bytes from `source` with HTTP Range support. Range headers are
 * interpreted relative to the logical content (`0..size-1`); stream
 * offsets are translated into absolute positions for window sources.
 */
export async function sendByteRangeWithHttpRange(
	reply: FastifyReply,
	source: ByteRangeSource,
	contentType: string,
	rangeHeader: string | undefined,
): Promise<FastifyReply> {
	reply.header("accept-ranges", "bytes")
	reply.header("content-type", contentType)
	reply.header("cache-control", "private, max-age=31536000, immutable")

	if (rangeHeader === undefined || !rangeHeader.startsWith("bytes=")) {
		reply.header("content-length", String(source.size))
		if (source.size === 0) return reply.send(Buffer.alloc(0))
		const stream =
			"path" in source
				? createReadStream(source.path, {
						start: source.start,
						end: source.end,
					})
				: await source.openStream()
		return reply.send(stream)
	}

	const parsedRange = parseByteRange(rangeHeader, source.size)
	if (!parsedRange.ok) {
		reply.header("content-range", `bytes */${source.size}`)
		sendJson(reply, 416, { error: "invalid or unsatisfiable range" })
		return reply
	}
	const { start, end } = parsedRange
	reply.code(206)
	reply.header("content-range", `bytes ${start}-${end}/${source.size}`)
	reply.header("content-length", String(end - start + 1))
	const stream =
		"path" in source
			? createReadStream(source.path, {
					start: source.start + start,
					end: source.start + end,
				})
			: sliceStream(await source.openStream(), start, end)
	return reply.send(stream)
}
