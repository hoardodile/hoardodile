import type { EntityMetaDraft } from "@hoardodile/schemas"

export function emptyEntityMetaDraft(
	defaults?: Partial<EntityMetaDraft>,
): EntityMetaDraft {
	return {
		name: "",
		intro: "",
		color: "",
		pinned: false,
		...defaults,
	}
}

export function entityMetaFromEntity(
	entity: Pick<EntityMetaDraft, "name" | "intro" | "pinned"> & {
		readonly color?: string | null
	},
): EntityMetaDraft {
	return {
		name: entity.name,
		intro: entity.intro,
		color: entity.color ?? "",
		pinned: entity.pinned,
	}
}

export function buildEntityMetaCreatePayload(
	draft: EntityMetaDraft,
): EntityMetaDraft | undefined {
	const name = draft.name.trim()
	if (name.length === 0) return undefined
	return {
		name,
		intro: draft.intro,
		color: draft.color,
		pinned: draft.pinned,
	}
}

export function buildEntityMetaUpdatePayload(
	id: string,
	draft: EntityMetaDraft,
): { id: string } & EntityMetaDraft {
	return {
		id,
		name: draft.name.trim(),
		intro: draft.intro,
		color: draft.color,
		pinned: draft.pinned,
	}
}
