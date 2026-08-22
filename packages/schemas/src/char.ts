import { z } from "zod"
import { charImageMeta } from "./image-meta.ts"
import { id, timestamp } from "./primitives.ts"
import { pinnedTag } from "./tag.ts"
import {
	MAX_CHARACTER_INTRO_LENGTH,
	MAX_COLOR_LENGTH,
	MAX_INTRO_LENGTH,
	MAX_NAME_LENGTH,
	MAX_RELATIONSHIP_LABEL_LENGTH,
	MAX_RELATIONSHIP_TYPE_NAME_LENGTH,
} from "./text-limits.ts"
import { TRAIT_KINDS } from "./trait.ts"

/**
 * Named subject who can appear in documents and be tagged. Images are stored
 * by convention in the character folder (`avatar.<ext>`, `fullbody.<ext>`).
 * `imageMeta` is a rebuildable projection of those files (empty sentinel vs
 * dimensions); `avatarVersion` / `fullbodyVersion` stay archive pointers
 * and are not on this object. `deletedAt` absent means the character is live.
 */
export const character = z.object({
	id,
	name: z.string().min(1).max(MAX_NAME_LENGTH),
	intro: z.string().max(MAX_CHARACTER_INTRO_LENGTH).default(""),
	tagIds: z.array(id).default([]),
	traitValues: z.record(z.string(), z.string()).default({}),
	imageMeta: charImageMeta.optional(),
	createdAt: timestamp,
	updatedAt: timestamp,
	deletedAt: timestamp.optional(),
})

export type Character = z.infer<typeof character>

export const pinnedTrait = z.object({
	id,
	name: z.string().min(1).max(MAX_NAME_LENGTH),
	color: z.string().max(MAX_COLOR_LENGTH).default(""),
	kind: z.enum(TRAIT_KINDS),
	value: z.string(),
})

export type PinnedTrait = z.infer<typeof pinnedTrait>

/**
 * Character with pre-computed pinned tags, returned by the `listCards` and
 * `detailCard` procedures. The `pinnedTags` array is already filtered
 * (tag.pinned OR category.pinned) and sorted (category.position â†’ tag.position)
 * by the server - no client-side post-processing needed.
 * `pinnedTraits` are trait definitions marked pinned with a non-empty value.
 * `relations` are directly related characters (both directions) whose
 * relationship type is pinned; filtered server-side.
 */
export const charCard = character.extend({
	pinnedTags: z.array(pinnedTag).default([]),
	pinnedTraits: z.array(pinnedTrait).default([]),
	relations: z
		.array(
			z.object({
				id,
				name: z.string().min(1).max(MAX_NAME_LENGTH),
				labels: z
					.array(z.string().max(MAX_RELATIONSHIP_LABEL_LENGTH))
					.default([]),
				color: z.string().max(MAX_COLOR_LENGTH).default(""),
				updatedAt: timestamp,
				imageMeta: charImageMeta.optional(),
			}),
		)
		.default([]),
})

export type CharCard = z.infer<typeof charCard>

/** How a relationship type behaves when linking characters. */
export const relationshipKind = z.enum([
	"directed",
	"symmetric",
	"hierarchical",
])
export type RelationshipKind = z.infer<typeof relationshipKind>

/** Which endpoint of a hierarchical edge is the superior side. */
export const hierarchyFrom = z.enum(["self", "target"])
export type HierarchyFrom = z.infer<typeof hierarchyFrom>

/** Optional per-edge metadata (order, note, etc.). */
export const charactershipMetadata = z
	.object({
		order: z.number().int().optional(),
		note: z.string().optional(),
	})
	.default({})
export type CharactershipMetadata = z.infer<typeof charactershipMetadata>

/**
 * Input for batch character fetch (`character.byIds`). Missing or trashed
 * ids are silently skipped server-side; the empty list is allowed and
 * trivially yields the empty result.
 */
export const charByIdsInput = z.object({
	ids: z.array(id).max(500).default([]),
})

/** Input for batch charactership fetch (`character.listCharactershipsForCharacters`). */
export const charactershipsForCharactersInput = z.object({
	charIds: z.array(id).max(100).default([]),
})

/**
 * Named relationship type between two characters. `selfLabel` is the label
 * for the self->target direction; `targetLabel` is for target->self.
 *
 * @example "Mentor/Apprentice" -- selfLabel: "mentor", targetLabel: "apprentice"
 */
export const relationshipType = z.object({
	id,
	name: z.string().min(1).max(MAX_RELATIONSHIP_TYPE_NAME_LENGTH),
	selfLabel: z.string().max(MAX_RELATIONSHIP_LABEL_LENGTH).default(""),
	targetLabel: z.string().max(MAX_RELATIONSHIP_LABEL_LENGTH).default(""),
	kind: relationshipKind.default("directed"),
	hierarchyFrom: hierarchyFrom.nullable().default(null),
	position: z.number().int().default(0),
	intro: z.string().max(MAX_INTRO_LENGTH).default(""),
	color: z.string().max(MAX_COLOR_LENGTH).default(""),
	pinned: z.boolean().default(false),
	createdAt: timestamp,
	updatedAt: timestamp,
})

export type RelationshipType = z.infer<typeof relationshipType>

/**
 * A relationship edge of a given `typeId`. Either both endpoints are
 * characters (selfId + targetId), or exactly one endpoint is a character
 * and the other is an external name. The real character ID determines which
 * side the external name occupies:
 *   - selfId set, targetId null  â†’ externalName is the target side.
 *   - selfId null, targetId set  â†’ externalName is the self side.
 * Self-links (selfId === targetId) are rejected for character-character edges.
 */
export const charactership = z
	.object({
		id,
		typeId: id,
		selfId: id.nullable().default(null),
		targetId: id.nullable().default(null),
		externalName: z.string().max(MAX_NAME_LENGTH).default(""),
		notes: z.string().max(MAX_CHARACTER_INTRO_LENGTH).default(""),
		metadata: charactershipMetadata,
		createdAt: timestamp,
	})
	.refine(
		(value) => {
			const hasExternal = value.externalName.length > 0
			const hasSelf = value.selfId !== null
			const hasTarget = value.targetId !== null
			// Exactly one of: normal edge (both IDs) or external edge (one ID + name).
			if (hasExternal) {
				return (hasSelf && !hasTarget) || (!hasSelf && hasTarget)
			}
			return hasSelf && hasTarget
		},
		{
			message:
				"charactership requires both selfId and targetId, or one id with externalName",
		},
	)
	.refine(
		(value) =>
			value.selfId === null ||
			value.targetId === null ||
			value.selfId !== value.targetId,
		{ message: "charactership self-loop is not allowed" },
	)

export type Charactership = z.infer<typeof charactership>
