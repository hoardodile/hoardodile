import {
	type ImageSlotMeta,
	imageSlotMeta as imageSlotMetaSchema,
} from "@hoardodile/schemas"
import { computeImageSlotFrom } from "src/infra/image-slots/meta.ts"
import type { TagFiles } from "./files.ts"
import { TAG_IMAGE_SLOT } from "./files.ts"
import type { TagRepository, TagRow } from "./repo.ts"

export function parseTagImageMeta(
	raw: string | null | undefined,
): ImageSlotMeta | undefined {
	if (raw === null || raw === undefined) return undefined
	try {
		const parsed: unknown = JSON.parse(raw)
		const result = imageSlotMetaSchema.safeParse(parsed)
		return result.success ? result.data : undefined
	} catch {
		return undefined
	}
}

/**
 * Fill missing tag image-meta projections from disk and persist without
 * bumping `updatedAt`. Returns a map covering every id that still exists.
 */
export async function ensureTagImageMeta(
	repo: TagRepository,
	files: TagFiles,
	ids: readonly string[],
): Promise<ReadonlyMap<string, ImageSlotMeta>> {
	const unique = [...new Set(ids)]
	const result = new Map<string, ImageSlotMeta>()
	await Promise.all(
		unique.map(async (id) => {
			let row: TagRow
			try {
				row = repo.findById(id)
			} catch {
				return
			}
			const current = parseTagImageMeta(row.imageMeta)
			if (current !== undefined) {
				result.set(id, current)
				return
			}
			const next = await computeImageSlotFrom(() =>
				files.findSlotInVersion(id, row.imageVersion, TAG_IMAGE_SLOT),
			)
			repo.patch(id, { imageMeta: JSON.stringify(next) })
			result.set(id, next)
		}),
	)
	return result
}
