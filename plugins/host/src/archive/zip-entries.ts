import { createReadStream, type ReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"
import { buffer } from "node:stream/consumers"
import { createInflateRaw } from "node:zlib"
import yauzl from "yauzl"
import { invalid } from "../errors.ts"

/**
 * Central directory entry shape exposed for the read-path cache. Mirrors
 * the fields yauzl surfaces, plus `dataOffset` resolved from the local
 * header. `dataOffset` and `dataSize` together pinpoint the entry's raw
 * bytes inside the zip file; for STORED entries those bytes are the file
 * itself and can be streamed via {@link streamRange} with a
 * `[start, end]` window.
 *
 * The central directory is parsed by yauzl (the only listing engine —
 * the hand-rolled fast parser was removed; ZIP64 falls out naturally).
 */
export type ZipEntry = {
	readonly name: string
	readonly compressionMethod: number
	/** General-purpose bit 0: the entry data is encrypted. */
	readonly encrypted: boolean
	readonly uncompressedSize: number
	readonly compressedSize: number
	readonly crc32: number
	readonly localHeaderOffset: number
	/**
	 * Absolute byte offset of the entry's raw data inside the zip file.
	 * Computed as `localHeaderOffset + 30 + nameLen + extraLen` where
	 * nameLen and extraLen are read from the local file header (not the
	 * central directory) because they can differ between the two.
	 */
	readonly dataOffset: number
	readonly dataSize: number
	readonly modifiedAt: number
}

/**
 * Random-access byte view over a zip archive. File-backed archives
 * (uploaded archive files and CLI fixtures) read via the filesystem;
 * nested archives — a zip entry inside the container — implement the same
 * range reads over the outer entry's inflated bytes. Everything in this
 * module that needs the archive's bytes takes a {@link ArchiveSource},
 * so the container and the plugin API resolve nested zips through one
 * code path.
 */
export type ArchiveSource = {
	/** Total archive size in bytes. */
	readonly size: number
	/** Read the inclusive byte range `[start, end]`. */
	readonly readRange: (start: number, end: number) => Promise<Buffer>
}

const RANGE_READ_CHUNK_BYTES = 256 * 1024

/** Wrap an on-disk zip in a {@link ArchiveSource}. */
export async function createFileArchiveSource(
	zipPath: string,
): Promise<ArchiveSource> {
	const info = await stat(zipPath)
	return {
		size: info.size,
		readRange: (start, end) => readFileRange(zipPath, start, end),
	}
}

/**
 * Read the central directory of the zip behind `source`, plus enough of
 * each local file header to compute `dataOffset`. Returns a flat list of
 * records ready for caching. Directory entries (names ending in `/`) are
 * excluded.
 *
 * The listing goes through yauzl over the {@link ArchiveSource} (via its
 * random-access-reader bridge); yauzl handles ZIP64 and validates entry
 * names while parsing. The `dataOffset` for byte-range access is
 * resolved from each local file header afterwards.
 *
 * @throws DomainError `resource.archive_open_failed` when the zip cannot
 *   be parsed.
 */
export async function listZipEntriesFromSource(
	source: ArchiveSource,
): Promise<readonly ZipEntry[]> {
	const zipfile = await openZipFromSource(source)
	const records: ZipEntry[] = []
	try {
		for await (const entry of zipfile.eachEntry()) {
			if (entry.fileName.endsWith("/")) continue
			const dataOffset = await resolveDataOffsetFromSource(
				source,
				entry.relativeOffsetOfLocalHeader,
			)
			records.push({
				name: entry.fileName,
				compressionMethod: entry.compressionMethod,
				encrypted: entry.isEncrypted(),
				uncompressedSize: entry.uncompressedSize,
				compressedSize: entry.compressedSize,
				crc32: entry.crc32,
				localHeaderOffset: entry.relativeOffsetOfLocalHeader,
				dataOffset,
				dataSize: entry.compressedSize,
				modifiedAt: entry.getLastModDate().getTime(),
			})
		}
	} catch (err) {
		// yauzl surfaces malformed central directories as plain errors
		// (e.g. encrypted stored entries with inconsistent sizes) — map
		// them onto the documented taxonomy.
		throw invalid(
			"resource.archive_open_failed",
			err instanceof Error ? err.message : "could not read archive entries",
			{ size: source.size },
		)
	} finally {
		zipfile.close()
	}
	return records
}

/** Read the central directory of the zip at `zipPath`. */
export async function listZipEntries(
	zipPath: string,
): Promise<readonly ZipEntry[]> {
	return listZipEntriesFromSource(await createFileArchiveSource(zipPath))
}

/**
 * Stream one entry's *decompressed* bytes from `source`. STORED entries
 * map to a byte-range stream of the raw data; DEFLATE entries inflate on
 * the fly. Encrypted entries and other compression methods reject with a
 * clear reason (there is no key to decrypt with). Callers are responsible
 * for consuming or destroying the stream (a dangling stream leaks an
 * inflate context).
 */
export function openZipEntryStream(
	source: ArchiveSource,
	record: ZipEntry,
): Readable {
	if (record.encrypted) {
		throw invalid(
			"resource.archive_open_failed",
			`zip entry "${record.name}" is encrypted — password-protected archives are not supported`,
			{ name: record.name },
		)
	}
	switch (record.compressionMethod) {
		case 0:
			return streamRange(
				source,
				record.dataOffset,
				record.dataOffset + record.dataSize - 1,
			)
		case 8: {
			const raw = streamRange(
				source,
				record.dataOffset,
				record.dataOffset + record.dataSize - 1,
			)
			const inflater = createInflateRaw()
			raw.on("error", (err) => inflater.destroy(err))
			return raw.pipe(inflater)
		}
		default:
			throw invalid(
				"resource.archive_open_failed",
				`unsupported zip entry compression method ${record.compressionMethod} for "${record.name}"`,
				{ method: record.compressionMethod, name: record.name },
			)
	}
}

/** Stream the inclusive byte range `[start, end]` in bounded chunks. */
export function streamRange(
	source: ArchiveSource,
	start: number,
	end: number,
): Readable {
	return Readable.from(
		(async function* rangeChunks() {
			let pos = start
			while (pos <= end) {
				const to = Math.min(end, pos + RANGE_READ_CHUNK_BYTES - 1)
				const chunk = await source.readRange(pos, to)
				if (chunk.length === 0) return
				yield chunk
				pos += chunk.length
			}
		})(),
	)
}

/** Stream `zipPath` bytes in the range `[start, end]` (inclusive). */ export function readZipRange(
	zipPath: string,
	start: number,
	end: number,
): ReadStream {
	return createReadStream(zipPath, { start, end })
}

/**
 * Read an inclusive byte range from `path`. Uses a read stream so offsets
 * beyond 2 GiB work on Node versions where `fs.read` position must fit in
 * Int32 (older releases assert instead of throwing).
 */
export async function readFileRange(
	path: string,
	start: number,
	end: number,
): Promise<Buffer> {
	if (
		!Number.isFinite(start) ||
		!Number.isFinite(end) ||
		!Number.isInteger(start) ||
		!Number.isInteger(end) ||
		start < 0 ||
		end < start
	) {
		throw invalid(
			"resource.file_read_failed",
			`invalid byte range ${start}..${end}`,
			{ path, start, end },
		)
	}
	const length = end - start + 1
	if (length <= 0) return Buffer.alloc(0)
	return buffer(readZipRange(path, start, end))
}

function openZipFromSource(source: ArchiveSource): Promise<yauzl.ZipFile> {
	const reader = new RangeReader(source)
	return yauzl
		.fromRandomAccessReaderPromise(reader, source.size, {
			lazyEntries: true,
			decodeStrings: true,
		})
		.catch((err: unknown) => {
			reader.close(() => {})
			throw invalid(
				"resource.archive_open_failed",
				err instanceof Error ? err.message : "could not open archive",
				{ size: source.size },
			)
		})
}

/**
 * yauzl's random-access-reader bridge. yauzl 3.x reads through
 * `createReadStream`/`read`, which are built on `_readStreamForRange`;
 * a subclass therefore only supplies range streams (chunked, so entries
 * are never buffered whole) plus `_close` (see yauzl's README).
 */
class RangeReader extends yauzl.RandomAccessReader {
	// Explicit field + assignment: this package ships source to Node's
	// type-stripping loader (no build step), which rejects parameter
	// properties.
	private readonly source: ArchiveSource

	constructor(source: ArchiveSource) {
		super()
		this.source = source
	}

	override _readStreamForRange(start: number, end: number): Readable {
		// yauzl's `end` is exclusive (it asserts exactly `end - start`
		// bytes); `streamRange` takes an inclusive end.
		return streamRange(this.source, start, end - 1)
	}

	// yauzl's runtime contract calls `_close` even though the shipped
	// types only expose the public `close` — no `override` here.
	_close(callback: (err?: Error | null) => void): void {
		callback(null)
	}
}

async function resolveDataOffsetFromSource(
	source: ArchiveSource,
	localHeaderOffset: number,
): Promise<number> {
	if (localHeaderOffset + 30 > source.size) {
		throw invalid(
			"resource.archive_open_failed",
			`truncated local file header at offset ${localHeaderOffset}`,
			{ localHeaderOffset },
		)
	}
	const head = await source.readRange(localHeaderOffset, localHeaderOffset + 29)
	if (head.length < 30) {
		throw invalid(
			"resource.archive_open_failed",
			`truncated local file header at offset ${localHeaderOffset}`,
			{ localHeaderOffset },
		)
	}
	const sig = head.readUInt32LE(0)
	if (sig !== 0x04034b50) {
		throw invalid(
			"resource.archive_open_failed",
			`bad local file header signature at offset ${localHeaderOffset}`,
			{ localHeaderOffset, sig: sig.toString(16) },
		)
	}
	const nameLen = head.readUInt16LE(26)
	const extraLen = head.readUInt16LE(28)
	return localHeaderOffset + 30 + nameLen + extraLen
}

/**
 * yauzl validates entry names while parsing the central directory and
 * rejects traversal/absolute names with a plain `Error`. Reclassify
 * those as the documented `resource.archive_invalid_entry` domain error
 * so every caller observes the same error taxonomy.
 */
export function normalizeZipError(err: unknown): unknown {
	if (!(err instanceof Error)) return err
	const message = err.message
	if (
		message.startsWith("invalid relative path: ") ||
		message.startsWith("absolute path: ") ||
		message.startsWith("invalid characters in fileName: ")
	) {
		return invalid("resource.archive_invalid_entry", message, {})
	}
	return err
}
