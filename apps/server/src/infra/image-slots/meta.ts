import { basename, extname } from "node:path"
import { probeImageSource } from "@hoardodile/host/probe"
import { EMPTY_IMAGE_SLOT, type ImageSlotMeta } from "@hoardodile/schemas"

/**
 * Probe one on-disk slot file into its rebuildable `ImageSlotMeta`
 * projection, shared by every image-slot domain (character
 * avatar/fullbody, tag art). `find` must return the absolute path of the
 * slot file, or `undefined` when the slot is absent — callers resolve it
 * against the archive version pointer stored on the row.
 *
 * Returns the `{ empty: true }` sentinel when the slot has no file;
 * `undefined` is reserved for "not computed yet" (see `@hoardodile/schemas`).
 */
export async function computeImageSlotFrom(
	find: () => Promise<string | undefined>,
): Promise<ImageSlotMeta> {
	const path = await find()
	if (path === undefined) return EMPTY_IMAGE_SLOT
	const ext = extname(path)
	const probe = await probeImageSource(path, ext)
	return {
		kind: "image",
		...(probe !== undefined
			? { width: probe.width, height: probe.height }
			: {}),
		source: basename(path),
	}
}
