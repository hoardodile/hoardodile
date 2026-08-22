import { z } from "zod"
import { id, timestamp } from "./primitives.ts"
import {
	MAX_COLOR_LENGTH,
	MAX_INTRO_LENGTH,
	MAX_NAME_LENGTH,
} from "./text-limits.ts"

/**
 * User-defined tag. Must be attached to a {@link Category}; `catId` is
 * required -- uncategorized tags are not allowed. `displayTagId` is the
 * sibling-group display this tag renders as: itself when ungrouped or
 * already the display. Rendering layers collapse members to their display
 * tag; storage keeps the real tag.
 *
 * `virtual` marks a tag that an entity only "has" through parent rules:
 * it is never stored on the entity, cannot be removed directly, and is
 * rendered distinctly. Only list-for-entity endpoints set it.
 */
export const tag = z.object({
	id,
	name: z.string().min(1).max(MAX_NAME_LENGTH),
	intro: z.string().max(MAX_INTRO_LENGTH).default(""),
	color: z.string().max(MAX_COLOR_LENGTH).default(""),
	position: z.number().int(),
	pinned: z.boolean(),
	catId: id,
	displayTagId: id,
	virtual: z.boolean().optional(),
	createdAt: timestamp,
	updatedAt: timestamp,
})

export type Tag = z.infer<typeof tag>

/**
 * Minimal tag shape embedded in character card responses. Contains only the
 * fields needed for display; full tag data lives in the tag module.
 * `color` is the effective display color: tag.color -> category.color -> "".
 * `virtual` marks a tag the entity only carries through rules (parent rules
 * or character links): it is never stored, cannot be removed directly, and
 * is rendered distinctly (weakened).
 */
export const pinnedTag = z.object({
	id,
	name: z.string().min(1).max(MAX_NAME_LENGTH),
	color: z.string().max(MAX_COLOR_LENGTH).default(""),
	virtual: z.boolean().optional(),
})
