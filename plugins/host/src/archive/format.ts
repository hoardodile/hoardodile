/**
 * Container format identification from magic bytes. The single source of
 * truth for "what archive format is this" — the engine matrix in
 * `./index.ts` maps each format to its list/extract/address
 * capabilities, and every dispatch (yauzl vs 7-Zip, nested resolver vs
 * whole-archive) keys off {@link sniffContainerFormat}.
 */

/** Byte window read from an entry to decide container-ness. */
export const SNIFF_WINDOW_BYTES = 4100

export type ContainerFormat = "zip" | "tar" | "7z" | "rar" | "xz" | "gzip"

/** True when `head` starts with the given magic byte sequence. */
function hasMagic(head: Uint8Array, magic: readonly number[]): boolean {
	if (head.byteLength < magic.length) return false
	for (let i = 0; i < magic.length; i++) {
		if (head[i] !== magic[i]) return false
	}
	return true
}

/**
 * Identify a container format from its leading bytes. Zip is addressable
 * as a nested container (`outer!inner`); the rest (tar/7z/rar/xz/gzip)
 * are only extractable as whole archives (see `extract-archive.ts` and
 * `extract.ts`).
 */
export function sniffContainerFormat(
	head: Uint8Array,
): ContainerFormat | undefined {
	if (hasMagic(head, [0x50, 0x4b, 0x03, 0x04])) return "zip"
	if (hasMagic(head, [0x50, 0x4b, 0x05, 0x06])) return "zip"
	if (head.byteLength >= 262) {
		const magic = String.fromCharCode(
			head[257]!,
			head[258]!,
			head[259]!,
			head[260]!,
			head[261]!,
		)
		if (magic === "ustar") return "tar"
	}
	if (hasMagic(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z"
	if (hasMagic(head, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return "rar"
	if (hasMagic(head, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return "xz"
	if (hasMagic(head, [0x1f, 0x8b, 0x08])) return "gzip"
	return undefined
}
