import { z } from "zod"
import { MAX_COLOR_LENGTH, MAX_INTRO_LENGTH } from "./text-limits.ts"

export type EntityMetaDraft = {
	readonly name: string
	readonly intro: string
	readonly color: string
	readonly pinned: boolean
}

export type EntityMetaSortable = Pick<EntityMetaDraft, "pinned" | "name"> & {
	readonly position: number
}

export type EntityMetaInputOptions = {
	readonly allowPosition?: boolean
	readonly positionNonNegative?: boolean
}

/** Optional meta patch fields for create/update (no name, no id). */
function entityMetaPatchShape(opts?: EntityMetaInputOptions) {
	const position = opts?.positionNonNegative
		? z.number().int().nonnegative().optional()
		: z.number().int().optional()
	const shape = {
		intro: z.string().max(MAX_INTRO_LENGTH).optional(),
		color: z.string().max(MAX_COLOR_LENGTH).optional(),
		pinned: z.boolean().optional(),
	} as const
	if (opts?.allowPosition === false) return shape
	return { ...shape, position }
}

export function entityMetaCreateInput(
	nameMax: number,
	opts?: EntityMetaInputOptions,
) {
	return z.object({
		name: z.string().min(1).max(nameMax),
		...entityMetaPatchShape(opts),
	})
}

export function entityMetaUpdateInput(
	nameMax: number,
	opts?: EntityMetaInputOptions,
) {
	return z.object({
		id: z.string().min(1),
		name: z.string().min(1).max(nameMax).optional(),
		...entityMetaPatchShape(opts),
	})
}

export const entityMetaReorderInput = z.object({
	ids: z.array(z.string().min(1)),
})

export type EntityMetaInsertInput = {
	readonly intro?: string
	readonly color?: string
	readonly position?: number
	readonly pinned?: boolean
}

export type EntityMetaCreateInput = EntityMetaInsertInput & {
	readonly name: string
}

export type EntityMetaUpdateInput = EntityMetaInsertInput & {
	readonly id: string
	readonly name?: string
}

/**
 * Stable display order: pinned first, then by `position`, then alphabetic
 * by `name`. Pure and deterministic.
 */
export function comparePinnedPositionName(
	a: EntityMetaSortable,
	b: EntityMetaSortable,
): number {
	if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
	if (a.position !== b.position) return a.position - b.position
	return a.name.localeCompare(b.name)
}
