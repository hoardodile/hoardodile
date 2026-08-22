import { crc32, deflateSync } from "node:zlib"

/**
 * Minimal solid-color PNG encoder and stored (uncompressed) zip writer for
 * e2e fixtures, ported from the validated reference in tmp/perf-lab/seed.mjs.
 * Produces real decodable images so content plugins import them exactly as
 * they would user uploads.
 */

export type Rgb = readonly [number, number, number]

/** Encodes a solid-color RGB PNG. */
export function solidPng(width: number, height: number, rgb: Rgb): Buffer {
	const [r, g, b] = rgb
	const raw = Buffer.alloc((width * 3 + 1) * height)
	for (let y = 0; y < height; y++) {
		const row = y * (width * 3 + 1)
		raw[row] = 0
		for (let x = 0; x < width; x++) {
			const i = row + 1 + x * 3
			raw[i] = r
			raw[i + 1] = g
			raw[i + 2] = b
		}
	}
	function chunk(type: string, data: Buffer): Buffer {
		const len = Buffer.alloc(4)
		len.writeUInt32BE(data.length)
		const body = Buffer.concat([Buffer.from(type, "ascii"), data])
		const crc = Buffer.alloc(4)
		crc.writeUInt32BE(crc32(body) >>> 0)
		return Buffer.concat([len, body, crc])
	}
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(height, 4)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 2 // color type RGB
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	])
}

export type ZipEntry = {
	readonly name: string
	readonly data: Buffer
}

/** Writes a stored (uncompressed) zip archive. */
export function storedZip(entries: readonly ZipEntry[]): Buffer {
	const locals: Buffer[] = []
	const centrals: Buffer[] = []
	let offset = 0
	for (const { name, data } of entries) {
		const nameBuf = Buffer.from(name, "utf-8")
		const crc = crc32(data) >>> 0
		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(20, 4)
		local.writeUInt16LE(0, 6) // flags
		local.writeUInt16LE(0, 8) // method: stored
		local.writeUInt16LE(0, 10) // time
		local.writeUInt16LE(0, 12) // date
		local.writeUInt32LE(crc, 14)
		local.writeUInt32LE(data.length, 18)
		local.writeUInt32LE(data.length, 22)
		local.writeUInt16LE(nameBuf.length, 26)
		local.writeUInt16LE(0, 28)
		locals.push(local, nameBuf, data)

		const central = Buffer.alloc(46)
		central.writeUInt32LE(0x02014b50, 0)
		central.writeUInt16LE(20, 4)
		central.writeUInt16LE(20, 6)
		central.writeUInt16LE(0, 8)
		central.writeUInt16LE(0, 10)
		central.writeUInt16LE(0, 12)
		central.writeUInt16LE(0, 14)
		central.writeUInt32LE(crc, 16)
		central.writeUInt32LE(data.length, 20)
		central.writeUInt32LE(data.length, 24)
		central.writeUInt16LE(nameBuf.length, 28)
		central.writeUInt32LE(offset, 42)
		centrals.push(central, nameBuf)
		offset += 30 + nameBuf.length + data.length
	}
	const cd = Buffer.concat(centrals)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(entries.length, 8)
	end.writeUInt16LE(entries.length, 10)
	end.writeUInt32LE(cd.length, 12)
	end.writeUInt32LE(offset, 16)
	return Buffer.concat([...locals, cd, end])
}
