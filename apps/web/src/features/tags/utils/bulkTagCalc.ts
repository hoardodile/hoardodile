export type TagLike = {
	readonly id: string
}

export type TagQueryLike = {
	readonly data: readonly TagLike[] | undefined
}

export function computeCommonAndNonCommonTagIds(
	tagQueries: readonly TagQueryLike[],
): {
	commonTagIds: readonly string[]
	nonCommonTagIds: readonly string[]
} {
	if (tagQueries.length === 0) {
		return { commonTagIds: [], nonCommonTagIds: [] }
	}

	const tagSets = tagQueries.map(
		(q) => new Set((q.data ?? []).map((t) => t.id)),
	)

	const intersection = new Set(tagSets[0] ?? [])
	for (let i = 1; i < tagSets.length; i++) {
		const set = tagSets[i]
		if (set === undefined) continue
		for (const id of intersection) {
			if (!set.has(id)) {
				intersection.delete(id)
			}
		}
	}

	const union = new Set<string>()
	for (const set of tagSets) {
		for (const id of set) {
			union.add(id)
		}
	}

	const nonCommon = new Set<string>()
	for (const id of union) {
		if (!intersection.has(id)) {
			nonCommon.add(id)
		}
	}

	return {
		commonTagIds: [...intersection],
		nonCommonTagIds: [...nonCommon],
	}
}

export function computeTagDiff(
	commonTagIds: readonly string[],
	selected: readonly string[],
): {
	toAttach: readonly string[]
	toDetach: readonly string[]
} {
	const before = new Set(commonTagIds)
	const after = new Set(selected)

	return {
		toAttach: selected.filter((id) => !before.has(id)),
		toDetach: commonTagIds.filter((id) => !after.has(id)),
	}
}
