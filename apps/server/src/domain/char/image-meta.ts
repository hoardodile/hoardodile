import { basename, extname } from "node:path"
import { probeImageSource } from "@hoardodile/host/probe"
import {
	type CharImageMeta,
	charImageMeta as charImageMetaSchema,
	EMPTY_IMAGE_SLOT,
	type ImageSlotMeta,
} from "@hoardodile/schemas"
import type { CharFiles } from "./files.ts"
import type { CharRepository, CharRow } from "./repo.ts"

export function parseCharImageMeta(
	raw: string | null | undefined,
): CharImageMeta | undefined {
	if (raw === null || raw === undefined) return undefined
	try {
		const parsed: unknown = JSON.parse(raw)
		const result = charImageMetaSchema.safeParse(parsed)
		return result.success ? result.data : undefined
	} catch {
		return undefined
	}
}

export async function computeImageSlot(
	files: CharFiles,
	id: string,
	variant: "avatar" | "fullbody",
	version: number,
): Promise<ImageSlotMeta> {
	const path = await files.findVariantInVersion(id, version, variant)
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

function slotVersion(row: CharRow, variant: "avatar" | "fullbody"): number {
	return variant === "avatar" ? row.avatarVersion : row.fullbodyVersion
}

/**
 * Fill missing avatar/fullbody slots from disk and persist without
 * bumping `updatedAt`. Returns a map covering every id that still exists.
 */
export async function ensureCharImageMeta(
	repo: CharRepository,
	files: CharFiles,
	ids: readonly string[],
): Promise<ReadonlyMap<string, CharImageMeta>> {
	const unique = [...new Set(ids)]
	const result = new Map<string, CharImageMeta>()
	await Promise.all(
		unique.map(async (id) => {
			let row: CharRow
			try {
				row = repo.findById(id)
			} catch {
				return
			}
			const current = parseCharImageMeta(row.imageMeta) ?? {}
			const needAvatar = current.avatar === undefined
			const needFullbody = current.fullbody === undefined
			if (!needAvatar && !needFullbody) {
				result.set(id, current)
				return
			}
			const next: CharImageMeta = { ...current }
			if (needAvatar) {
				next.avatar = await computeImageSlot(
					files,
					id,
					"avatar",
					slotVersion(row, "avatar"),
				)
			}
			if (needFullbody) {
				next.fullbody = await computeImageSlot(
					files,
					id,
					"fullbody",
					slotVersion(row, "fullbody"),
				)
			}
			repo.patch(id, { imageMeta: JSON.stringify(next) })
			result.set(id, next)
		}),
	)
	return result
}
