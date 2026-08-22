import { PHASH_GRID } from "@hoardodile/host"
import sharp from "sharp"

/**
 * Decode one frame of the image at `path` as a `PHASH_GRID × PHASH_GRID`
 * grayscale buffer — the exact rendition every perceptual hash derives
 * from (mirrors the plugin host's `decodeGrayGrid`). Undecodable input
 * resolves to `undefined`.
 */
export async function decodeGrayGridFromFile(
	path: string,
): Promise<Uint8Array | undefined> {
	try {
		const { data } = await sharp(path, { pages: 1 })
			.resize(PHASH_GRID, PHASH_GRID, { fit: "fill" })
			.grayscale()
			.raw()
			.toBuffer({ resolveWithObject: true })
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
	} catch {
		return undefined
	}
}
