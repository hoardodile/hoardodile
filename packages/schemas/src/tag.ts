import { z } from "zod"
import { imageSlotMeta } from "./image-meta.ts"
import { id, timestamp } from "./primitives.ts"
import {
	MAX_COLOR_LENGTH,
	MAX_INTRO_LENGTH,
	MAX_NAME_LENGTH,
	MAX_URL_LENGTH,
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
 *
 * `link` is a user-supplied external URL (may be scheme-less pastes, so
 * no strict `url()` — see the resource `sourceUrl` precedent); absent or
 * empty means "no link". `imageMeta` is the rebuildable projection of
 * the tag's single image slot, keyed by the archive `imageVersion`
 * pointer (which is deliberately not on this object, mirroring
 * {@link Character}`s `avatarVersion`/`fullbodyVersion`).
 */
/**
 * Tag visibility policy (see `apps/server/src/domain/tag/visibility.ts`).
 * `watch_only` narrows character/resource content to entries carrying the
 * tag when the global watch-only toggle is on; `explicit_view` hides such
 * content unless the tag is explicitly selected for viewing. Everything
 * else (default) is `normal`.
 */
export const tagVisibility = z.enum(["normal", "watch_only", "explicit_view"])
export type TagVisibility = z.infer<typeof tagVisibility>

export const tag = z.object({
	id,
	name: z.string().min(1).max(MAX_NAME_LENGTH),
	intro: z.string().max(MAX_INTRO_LENGTH).default(""),
	color: z.string().max(MAX_COLOR_LENGTH).default(""),
	link: z.string().max(MAX_URL_LENGTH).optional(),
	imageMeta: imageSlotMeta.optional(),
	position: z.number().int(),
	pinned: z.boolean(),
	visibility: tagVisibility.default("normal"),
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
