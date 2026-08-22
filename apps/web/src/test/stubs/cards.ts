import type { CharCard, ResCard } from "@hoardodile/schemas"

export function stubResCard(
	id: string,
	name: string,
	overrides?: Partial<ResCard>,
): ResCard {
	return {
		id,
		name,
		intro: "",
		tagIds: [],
		charIds: [],
		contentPluginId: null,
		pinnedTags: [],
		characters: [],
		collections: [],
		coverVersion: 1,
		createdAt: 100,
		updatedAt: 100,
		dislikeCount: 0,
		dislikedRecently: false,
		...overrides,
	} satisfies ResCard
}

export function stubCharCard(
	id: string,
	name: string,
	overrides?: Partial<CharCard>,
): CharCard {
	return {
		id,
		name,
		intro: "",
		tagIds: [],
		traitValues: {},
		pinnedTags: [],
		pinnedTraits: [],
		relations: [],
		createdAt: 100,
		updatedAt: 100,
		...overrides,
	} satisfies CharCard
}
