import { fileTypeFromName } from "@hoardodile/sdk-types"
import { mimeToKind } from "@hoardodile/sdk-types/media-exts"

import type { FileType } from "../types.ts"

/**
 * Content sniffing: what a file's bytes say it is, with the filename as
 * the fallback rather than the verdict.
 *
 * The layering mirrors what the ecosystem settled on (freedesktop's
 * shared-mime-info, Apache Tika, WHATWG mimesniff): magic-byte matching
 * decides for binary formats, and the extension only answers for
 * formats that carry no signature at all — text, subtitles, CSV. That
 * split is why a `.jpg` holding WebP bytes probes as WebP, while a
 * `.txt` still resolves to `text/plain`.
 */

/**
 * Header window handed to the magic matcher. `file-type` documents 4100
 * bytes as the sample size that makes its detection deterministic; the
 * host reads exactly that much and no more, so sniffing an entry costs
 * one small ranged read.
 */
export const SNIFF_HEADER_BYTES = 4100

type FileTypeModule = typeof import("file-type")

let fileTypePromise: Promise<FileTypeModule> | undefined

/**
 * Load the magic-byte matcher lazily. Sniffing is opt-in per host (the
 * directory backend never sniffs), so an unused host pays nothing for
 * the module graph.
 */
function loadFileType(): Promise<FileTypeModule> {
	fileTypePromise ??= import("file-type")
	return fileTypePromise
}

/**
 * Identify a file from a leading byte window plus its name. `head`
 * should hold the first {@link SNIFF_HEADER_BYTES} bytes; a shorter
 * slice still works for formats whose signature fits inside it.
 */
export async function sniffBytes(
	head: Uint8Array,
	path: string,
): Promise<FileType | undefined> {
	if (head.byteLength > 0) {
		try {
			const { fileTypeFromBuffer } = await loadFileType()
			const detected = await fileTypeFromBuffer(head)
			if (detected !== undefined) {
				return {
					mime: detected.mime,
					ext: `.${detected.ext}`,
					kind: mimeToKind(detected.mime),
					source: "magic",
				}
			}
		} catch {
			// A malformed or truncated header is not an error condition —
			// fall through to the filename, same as a signature-less file.
		}
	}
	return fileTypeFromName(path)
}
