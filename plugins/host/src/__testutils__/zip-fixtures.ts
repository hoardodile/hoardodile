import { deflateRawSync } from "node:zlib"

/**
 * Test-only zip/tar writers shared by the host's container tests. Real
 * archives built in memory so the nested/extraction paths exercise
 * actual STORED/DEFLATE bytes without external dependencies.
 */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[n] = c >>> 0
	}
	return table
})()

export function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff
	for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

export type ZipEntryInput = {
	readonly name: string
	readonly data: Uint8Array
	/** 0 = STORED, 8 = DEFLATE. Default STORED. */
	readonly method?: number
	/** Set the general-purpose encryption bit (bit 0). */
	readonly encrypted?: boolean
	/**
	 * Write the name as raw latin1 bytes without the UTF-8 flag (bit 11) —
	 * the legacy cp437 shape 7-Zip decodes. Name chars above U+00FF are
	 * truncated to their low byte, exactly like a pre-UTF-8 zipper.
	 */
	readonly legacyName?: boolean
}

/** Minimal zip writer: STORED or DEFLATE entries, UTF-8 names. */
export function makeZip(entries: readonly ZipEntryInput[]): Buffer {
	const parts: Buffer[] = []
	const records: Buffer[] = []
	let offset = 0
	for (const entry of entries) {
		const name =
			entry.legacyName === true
				? Buffer.from(entry.name, "latin1")
				: Buffer.from(entry.name, "utf8")
		const method = entry.method ?? 0
		const flags =
			(entry.legacyName === true ? 0 : 0x0800) |
			(entry.encrypted === true ? 0x1 : 0)
		const raw =
			method === 8
				? deflateRawSync(Buffer.from(entry.data))
				: Buffer.from(entry.data)
		const crc = crc32(entry.data)
		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(20, 4)
		local.writeUInt16LE(flags, 6) // UTF-8 name flag (+ encryption bit)
		local.writeUInt16LE(method, 8)
		local.writeUInt16LE(0, 10)
		local.writeUInt16LE(0, 12)
		local.writeUInt32LE(crc, 14)
		local.writeUInt32LE(raw.length, 18)
		local.writeUInt32LE(entry.data.length, 22)
		local.writeUInt16LE(name.length, 26)
		local.writeUInt16LE(0, 28)
		parts.push(local, name, raw)

		const cd = Buffer.alloc(46)
		cd.writeUInt32LE(0x02014b50, 0)
		cd.writeUInt16LE(20, 4)
		cd.writeUInt16LE(20, 6)
		cd.writeUInt16LE(flags, 8)
		cd.writeUInt16LE(method, 10)
		cd.writeUInt16LE(0, 12)
		cd.writeUInt16LE(0, 14)
		cd.writeUInt32LE(crc, 16)
		cd.writeUInt32LE(raw.length, 20)
		cd.writeUInt32LE(entry.data.length, 24)
		cd.writeUInt16LE(name.length, 28)
		cd.writeUInt16LE(0, 30)
		cd.writeUInt16LE(0, 32)
		cd.writeUInt16LE(0, 34)
		cd.writeUInt16LE(0, 36)
		cd.writeUInt32LE(0, 38)
		cd.writeUInt32LE(offset, 42)
		records.push(Buffer.concat([cd, name]))
		offset += local.length + name.length + raw.length
	}
	const cdStart = parts.reduce((sum, p) => sum + p.length, 0)
	const cdBytes = Buffer.concat(records)
	const eocd = Buffer.alloc(22)
	eocd.writeUInt32LE(0x06054b50, 0)
	eocd.writeUInt16LE(0, 4)
	eocd.writeUInt16LE(0, 6)
	eocd.writeUInt16LE(entries.length, 8)
	eocd.writeUInt16LE(entries.length, 10)
	eocd.writeUInt32LE(cdBytes.length, 12)
	eocd.writeUInt32LE(cdStart, 16)
	eocd.writeUInt16LE(0, 20)
	return Buffer.concat([...parts, cdBytes, eocd])
}

/** Minimal plain-tar writer (ustar headers with checksums, no compression). */
export function makeTar(
	entries: readonly { name: string; data: Uint8Array }[],
): Buffer {
	const parts: Buffer[] = []
	for (const entry of entries) {
		const header = Buffer.alloc(512)
		header.write(entry.name, 0, 100, "utf8")
		header.write("0000644\0", 100, 8, "ascii")
		header.write(
			entry.data.length.toString(8).padStart(11, "0"),
			124,
			12,
			"ascii",
		)
		header.writeUInt8(0x30, 156)
		header.write("ustar", 257, 5, "ascii")
		header.write("00", 262, 2, "ascii")
		// Header checksum: unsigned sum of all bytes with the checksum
		// field treated as spaces, formatted as 6 octal digits + NUL.
		let sum = 0
		for (let i = 0; i < 512; i++) {
			sum += i >= 148 && i < 156 ? 0x20 : header[i]!
		}
		header.write(sum.toString(8).padStart(6, "0"), 148, 6, "ascii")
		parts.push(header, Buffer.from(entry.data))
		const pad = (512 - (entry.data.length % 512)) % 512
		if (pad > 0) parts.push(Buffer.alloc(pad))
	}
	parts.push(Buffer.alloc(1024))
	return Buffer.concat(parts)
}
