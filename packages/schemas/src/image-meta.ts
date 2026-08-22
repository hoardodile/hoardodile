import { z } from "zod"

/**
 * Computed-empty sentinel shared by resource `coverMeta` and character
 * `imageMeta` slots. Distinct from a missing field: missing means "not
 * computed yet" (the client may still probe the thumb route); this object
 * means "computed, there is no file".
 */
export const emptyMeta = z.object({
	empty: z.literal(true),
})
export type EmptyMeta = z.infer<typeof emptyMeta>

export const EMPTY_IMAGE_SLOT: EmptyMeta = { empty: true }

export function isEmptyMeta(value: unknown): value is EmptyMeta {
	if (typeof value !== "object" || value === null) return false
	return (value as { empty?: unknown }).empty === true
}

/**
 * One still-image slot (character avatar / fullbody). `kind` is always
 * `"image"` when a file exists; dimensions are optional when probe failed
 * but the file is on disk.
 */
export const imageSlotMeta = z.union([
	emptyMeta,
	z.object({
		kind: z.literal("image"),
		width: z.number().int().positive().optional(),
		height: z.number().int().positive().optional(),
		source: z.string().optional(),
	}),
])
export type ImageSlotMeta = z.infer<typeof imageSlotMeta>

/**
 * Rebuildable character image projection. Disk remains the byte SSOT;
 * this JSON records whether each variant has been computed and, when a
 * file exists, its intrinsic size. `avatarVersion` / `fullbodyVersion`
 * stay archive pointers and are not this object's keys.
 */
export const charImageMeta = z.object({
	avatar: imageSlotMeta.optional(),
	fullbody: imageSlotMeta.optional(),
})
export type CharImageMeta = z.infer<typeof charImageMeta>

export const EMPTY_CHAR_IMAGE_META: CharImageMeta = {
	avatar: EMPTY_IMAGE_SLOT,
	fullbody: EMPTY_IMAGE_SLOT,
}

/**
 * `undefined` — slot not computed (probe the thumb).
 * `false` — computed empty (do not request).
 * `true` — a file exists (request the thumb).
 */
export function imageSlotHasFile(
	slot: ImageSlotMeta | undefined,
): boolean | undefined {
	if (slot === undefined) return undefined
	if (isEmptyMeta(slot)) return false
	return true
}
