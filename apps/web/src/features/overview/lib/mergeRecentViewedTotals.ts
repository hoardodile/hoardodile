import type { UsageEntityType, UsageTotal } from "@hoardodile/schemas"

function recentViewedSortKey(row: UsageTotal): number {
	if (row.lastViewedAt === null) return Number.NEGATIVE_INFINITY
	return row.lastViewedAt
}

function compareRecentViewed(a: UsageTotal, b: UsageTotal): number {
	const byViewed = recentViewedSortKey(b) - recentViewedSortKey(a)
	if (byViewed !== 0) return byViewed
	return b.updatedAt - a.updatedAt
}

function isRecentViewedEntityType(
	entityType: UsageEntityType,
): entityType is "resource" | "character" | "document" {
	return (
		entityType === "resource" ||
		entityType === "character" ||
		entityType === "document"
	)
}

export function mergeRecentViewedTotals(
	groups: readonly (readonly UsageTotal[])[],
): UsageTotal[] {
	const byKey = new Map<string, UsageTotal>()

	for (const group of groups) {
		for (const row of group) {
			if (!isRecentViewedEntityType(row.entityType)) continue
			const key = `${row.entityType}:${row.entityId}`
			const existing = byKey.get(key)
			if (existing === undefined || compareRecentViewed(row, existing) < 0) {
				byKey.set(key, row)
			}
		}
	}

	return [...byKey.values()].sort(compareRecentViewed)
}
