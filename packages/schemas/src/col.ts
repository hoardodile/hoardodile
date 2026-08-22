import { z } from "zod"
import { id, timestamp } from "./primitives.ts"
import {
	MAX_COLOR_LENGTH,
	MAX_INTRO_LENGTH,
	MAX_NAME_LENGTH,
} from "./text-limits.ts"

/**
 * A user-curated grouping of resources (e.g. a chapter sequence, a
 * series collection, or a doujinshi set). Resources may belong to
 * multiple collections.
 */
export const resCollection = z.object({
	id,
	name: z.string().min(1).max(MAX_NAME_LENGTH),
	intro: z.string().max(MAX_INTRO_LENGTH).default(""),
	color: z.string().max(MAX_COLOR_LENGTH).default(""),
	position: z.number().int(),
	pinned: z.boolean(),
	createdAt: timestamp,
	updatedAt: timestamp,
})

export type ResCollection = z.infer<typeof resCollection>

/** Compact projection embedded in resource card responses. */
export const resCollectionChip = z.object({
	id,
	name: z.string().min(1).max(MAX_NAME_LENGTH),
	color: z.string().max(MAX_COLOR_LENGTH).default(""),
})

export type ResCollectionChip = z.infer<typeof resCollectionChip>
