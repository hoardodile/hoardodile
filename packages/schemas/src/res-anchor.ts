import type { ResAnchor } from "@hoardodile/sdk-types"
import { anchorData as anchorDataSchema } from "@hoardodile/sdk-types/schema"
import { z } from "zod"
import { id } from "./primitives.ts"

/**
 * Generic pointer into a specific location within a resource. Used by
 * comments and danmaku to attach themselves to a precise location so
 * readers can surface inline annotations and clients can navigate
 * back to the exact spot where a remark was made.
 *
 * `resId` is derived by the server from the row's `anchor_resource_id`
 * column — plugin code never supplies it. Plugins attach their own
 * opaque location data via `data` (e.g. page number, paragraph index,
 * timestamp). The plugin's anchor template (`ui.message.anchor`)
 * interprets this data for display and navigation.
 */
export const resAnchor = z.object({
	resId: id,
	/** Plugin-defined location data. Interpreted by the owning plugin. */
	data: z.unknown().optional(),
})
export type { ResAnchor }

/**
 * Wire/storage anchor envelope: the plugin location payload only,
 * validated identically by the host and the server (see
 * `@hoardodile/sdk-types` {@link anchorDataSchema}).
 */
export const anchorData = anchorDataSchema

/**
 * Filter shape for listing rows whose anchor targets a given resource.
 * Server filters by `resId` only; plugin-specific location filtering
 * happens client-side through the plugin render module.
 */
export const resAnchorFilter = z.object({
	resId: id,
})
export type ResAnchorFilter = z.infer<typeof resAnchorFilter>
