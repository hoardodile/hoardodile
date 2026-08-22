import { z } from "zod"
import { id, timestamp } from "./primitives.ts"
import {
	MAX_COLOR_LENGTH,
	MAX_INTRO_LENGTH,
	MAX_NAME_LENGTH,
} from "./text-limits.ts"

/** Discriminates what kind of entity a {@link Category} may contain. */
export const catKind = z.enum(["common", "resource", "character"])
export type CatKind = z.infer<typeof catKind>

/**
 * Flat grouping used by tags, resources, and characters. Categories have no
 * hierarchy - every category is a peer of every other.
 */
export const category = z.object({
	id,
	name: z.string().min(1).max(MAX_NAME_LENGTH),
	intro: z.string().max(MAX_INTRO_LENGTH).default(""),
	color: z.string().max(MAX_COLOR_LENGTH).default(""),
	kind: catKind,
	position: z.number().int(),
	pinned: z.boolean(),
	createdAt: timestamp,
	updatedAt: timestamp,
})

export type Category = z.infer<typeof category>
