import { MAX_DANMAKU_TEXT_LENGTH } from "@hoardodile/sdk-types/text-limits"
import { z } from "zod"
import { id, timestamp } from "./primitives.ts"
import { anchorData, resAnchor, resAnchorFilter } from "./res-anchor.ts"
import { MAX_DANMAKU_COLOR_LENGTH } from "./text-limits.ts"

/**
 * Danmaku ("bullet comment") posted against a specific location in a
 * resource. Append-only: rows are immutable once created. Removal is
 * hard-delete.
 *
 * `mode` mirrors the conventional categories used by DPlayer / NicoNico
 * style players:
 * - `scroll` -- slides right->left across the surface (default lane)
 * - `top`    -- pinned at the top center for a fixed duration
 * - `bottom` -- pinned at the bottom center for the same duration
 */
export const danmakuMode = z.enum(["scroll", "top", "bottom"])
export type DanmakuMode = z.infer<typeof danmakuMode>

export const danmaku = z.object({
	id,
	/**
	 * Pointer into a specific location within a resource. The resource
	 * id is derived by the server from the row's `anchor_resource_id`
	 * column. Plugin-specific location data is carried in `anchor.data`.
	 */
	anchor: resAnchor,
	text: z.string().min(1).max(MAX_DANMAKU_TEXT_LENGTH),
	/** CSS color string (`#rrggbb`); empty string means client default. */
	color: z.string().max(MAX_DANMAKU_COLOR_LENGTH),
	mode: danmakuMode,
	createdAt: timestamp,
})

export type Danmaku = z.infer<typeof danmaku>

export const danmakuListInput = z.object({
	/** Filter by resource. Plugin-specific location filtering is client-side. */
	anchor: resAnchorFilter,
})
export type DanmakuListInput = z.infer<typeof danmakuListInput>

export const danmakuCreateInput = z.object({
	/**
	 * Plugin-defined location payload. The resource id travels
	 * separately in `anchorResId` and is written to the row's
	 * `anchor_resource_id` column by the server.
	 */
	anchor: anchorData,
	/** Resource this danmaku is anchored to. */
	anchorResId: id,
	text: z.string().min(1).max(MAX_DANMAKU_TEXT_LENGTH),
	color: z.string().max(MAX_DANMAKU_COLOR_LENGTH).optional(),
	mode: danmakuMode.optional(),
})
export type DanmakuCreateInput = z.infer<typeof danmakuCreateInput>

export const danmakuDeleteInput = z.object({
	id,
})
export type DanmakuDeleteInput = z.infer<typeof danmakuDeleteInput>
