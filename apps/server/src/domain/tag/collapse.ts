import { eq, inArray, sql } from "drizzle-orm"
import { categories } from "src/domain/cat/schema.ts"
import type { DbClient } from "src/infra/db/connection.ts"
import {
	charMemberIdsOf,
	charSiblingDisplayOf,
	type ParentRule,
	type SiblingPair,
	siblingDisplayOf,
	siblingGroupOf,
} from "./rules.ts"
import { parentRules, siblingPairs, tags } from "./schema.ts"

/**
 * Display-collapse for pinned tag rows (M2): sibling groups render as a
 * single display tag everywhere, cards included. Applied at the hydration
 * layer per the PRD — the repo SQL that produces `pinnedTags` stays
 * untouched; this pure remap runs on its results.
 *
 * Every pinned member is replaced by its group's display tag row (name,
 * effective color), duplicates collapse, and the list re-sorts by the
 * display tag's own (category position, tag position) so a pinned member
 * that displays as a tag in another namespace moves to that tag's place.
 * Without sibling pairs the input passes through unchanged.
 */

export type PinnedTagRow = {
	readonly id: string
	readonly name: string
	readonly color: string
	/** True for tags the entity only carries through rules. */
	readonly virtual?: boolean
}

export function collapsePinnedTags(
	client: DbClient,
	rows: readonly PinnedTagRow[],
	pairs: readonly SiblingPair[] = loadSiblingPairs(client),
): readonly PinnedTagRow[] {
	if (rows.length === 0) return []
	if (pairs.length === 0) return rows
	if (!rows.some((r) => (siblingDisplayOf(pairs, r.id) ?? r.id) !== r.id)) {
		return rows
	}

	const displayIds = [
		...new Set(rows.map((r) => siblingDisplayOf(pairs, r.id) ?? r.id)),
	]
	const displayRows = client
		.select({
			id: tags.id,
			name: tags.name,
			color: sql<string>`COALESCE(NULLIF(${tags.color}, ''), NULLIF(${categories.color}, ''), '')`,
			categoryPosition: sql<number>`COALESCE(${categories.position}, 2147483647)`,
			position: tags.position,
		})
		.from(tags)
		.leftJoin(categories, eq(tags.catId, categories.id))
		.where(inArray(tags.id, displayIds))
		.all()
	const byId = new Map(displayRows.map((r) => [r.id, r]))

	const collapsed: PinnedTagRow[] = []
	const seen = new Set<string>()
	for (const row of rows) {
		const displayId = siblingDisplayOf(pairs, row.id) ?? row.id
		if (seen.has(displayId)) continue
		seen.add(displayId)
		const display = byId.get(displayId)
		if (display === undefined) continue
		collapsed.push({ id: display.id, name: display.name, color: display.color })
	}
	collapsed.sort((a, b) => {
		const da = byId.get(a.id)
		const db = byId.get(b.id)
		if (da === undefined || db === undefined) return 0
		if (da.categoryPosition !== db.categoryPosition) {
			return da.categoryPosition - db.categoryPosition
		}
		if (da.position !== db.position) return da.position - db.position
		return a.name.localeCompare(b.name)
	})
	return collapsed
}

/**
 * Which entity-level carriers drive the virtual-tag projection of a
 * pinned-tag row set:
 * - `tagIds`: the entity's directly attached (pre-collapse) tag ids.
 * - `characterIds`: for resources, the linked character ids; for
 *   character cards, `[selfId]` so a character's own link counts.
 */
export type PinnedVirtualInput = {
	readonly tagIds: readonly string[]
	readonly characterIds: readonly string[]
}

/**
 * Append the entity's virtual pinned tags (M3 + character links): every
 * tag the entity carries through parent rules — or through a linked
 * character's sibling link — appears here if pinned (tag or category),
 * weakened with `virtual: true` and interleaved into the pinned sort
 * order. The rules graph is walked once for all carriers; without parent
 * rules the input passes through unchanged (fast path).
 *
 * `rows` must already be sibling-collapsed (see {@link collapsePinnedTags}).
 */
export function withPinnedVirtualTags(
	client: DbClient,
	rows: readonly PinnedTagRow[],
	input: PinnedVirtualInput,
	pairs: readonly SiblingPair[] = loadSiblingPairs(client),
	rules: readonly ParentRule[] = loadParentRules(client),
): readonly PinnedTagRow[] {
	if (
		rules.length === 0 &&
		(input.characterIds.length === 0 || pairs.length === 0)
	) {
		// No parent rules and nothing character-derived: nothing virtual.
		return rows
	}

	const parentsOf = new Map<string, string[]>()
	for (const rule of rules) {
		const key = `${rule.childKind}:${rule.childId}`
		const list = parentsOf.get(key) ?? []
		list.push(rule.parentId)
		parentsOf.set(key, list)
	}
	const groupOf = (id: string) =>
		pairs.length === 0 ? new Set<string>([id]) : siblingGroupOf(pairs, id)
	const toDisplay = (id: string) =>
		pairs.length === 0 ? id : (siblingDisplayOf(pairs, id) ?? id)

	// Carriers: every display tag the entity carries — attached tags
	// (pinned or not — their parents may be pinned) plus linked
	// characters' display tags (virtual by construction). A character
	// display is virtual even when an attached member collapses to the
	// same display (that member may not be pinned); only an actual
	// pinned row for the display suppresses the virtual copy. The
	// pinned filter below keeps only the rows that belong on the card.
	const pinnedSeen = new Set<string>(rows.map((r) => r.id))
	const virtualSeen = new Set<string>()
	const carried: string[] = []
	const virtualIds: string[] = []
	const pushCarried = (displayId: string, virtual: boolean) => {
		carried.push(displayId)
		if (!virtual) return
		if (pinnedSeen.has(displayId)) return
		if (virtualSeen.has(displayId)) return
		virtualSeen.add(displayId)
		virtualIds.push(displayId)
	}
	for (const tagId of input.tagIds) pushCarried(toDisplay(tagId), false)
	for (const charId of input.characterIds) {
		if (pairs.length === 0) continue
		const display = charSiblingDisplayOf(pairs, charId)
		if (display !== undefined) pushCarried(display, true)
	}
	// Parent closure: parents of every group member (tags and characters)
	// of every carried display, plus character-child rules of the entity's
	// linked characters themselves, transitively, collapsed to displays.
	const stack: string[] = []
	for (const id of carried) {
		for (const member of groupOf(id)) {
			stack.push(...(parentsOf.get(`tag:${member}`) ?? []))
		}
		for (const member of charMemberIdsOf(pairs, id)) {
			stack.push(...(parentsOf.get(`character:${member}`) ?? []))
		}
	}
	for (const charId of input.characterIds) {
		stack.push(...(parentsOf.get(`character:${charId}`) ?? []))
	}
	while (stack.length > 0) {
		const parentId = stack.pop()
		if (parentId === undefined) continue
		const displayId = toDisplay(parentId)
		if (virtualSeen.has(displayId)) continue
		virtualSeen.add(displayId)
		if (!pinnedSeen.has(displayId)) virtualIds.push(displayId)
		for (const member of groupOf(displayId)) {
			stack.push(...(parentsOf.get(`tag:${member}`) ?? []))
		}
		for (const member of charMemberIdsOf(pairs, displayId)) {
			stack.push(...(parentsOf.get(`character:${member}`) ?? []))
		}
	}
	if (virtualIds.length === 0) return rows

	const virtualRows = client
		.select({
			id: tags.id,
			name: tags.name,
			color: sql<string>`COALESCE(NULLIF(${tags.color}, ''), NULLIF(${categories.color}, ''), '')`,
			categoryPosition: sql<number>`COALESCE(${categories.position}, 2147483647)`,
			position: tags.position,
			pinned: tags.pinned,
			categoryPinned: categories.pinned,
		})
		.from(tags)
		.leftJoin(categories, eq(tags.catId, categories.id))
		.where(inArray(tags.id, virtualIds))
		.all()
	const virtualByPinned = virtualRows
		.filter((r) => r.pinned || r.categoryPinned)
		.map((r) => ({ id: r.id, name: r.name, color: r.color }))
	if (virtualByPinned.length === 0) return rows

	// Re-sort the merged set by each row's (category position, position,
	// name) — one combined fetch for the sort keys of every display id.
	const allIds = [
		...new Set([...rows.map((r) => r.id), ...virtualByPinned.map((r) => r.id)]),
	]
	const sortKeys = new Map(
		client
			.select({
				id: tags.id,
				categoryPosition: sql<number>`COALESCE(${categories.position}, 2147483647)`,
				position: tags.position,
			})
			.from(tags)
			.leftJoin(categories, eq(tags.catId, categories.id))
			.where(inArray(tags.id, allIds))
			.all()
			.map((r) => [r.id, r]),
	)
	const merged = [
		...rows,
		...virtualByPinned.map((r) => ({ ...r, virtual: true as const })),
	]
	merged.sort((a, b) => {
		const ka = sortKeys.get(a.id)
		const kb = sortKeys.get(b.id)
		if (ka === undefined || kb === undefined) return 0
		if (ka.categoryPosition !== kb.categoryPosition) {
			return ka.categoryPosition - kb.categoryPosition
		}
		if (ka.position !== kb.position) return ka.position - kb.position
		return a.name.localeCompare(b.name)
	})
	return merged
}

export function loadSiblingPairs(client: DbClient): readonly SiblingPair[] {
	return client
		.select({
			badKind: siblingPairs.badKind,
			badId: siblingPairs.badId,
			badCharacterId: siblingPairs.badCharacterId,
			goodId: siblingPairs.goodId,
		})
		.from(siblingPairs)
		.all()
		.map((r) => ({
			badKind: r.badKind,
			badId: r.badId ?? r.badCharacterId!,
			goodId: r.goodId,
		}))
}

export function loadParentRules(client: DbClient): readonly ParentRule[] {
	return client
		.select({
			childKind: parentRules.childKind,
			childId: parentRules.childId,
			childCharacterId: parentRules.childCharacterId,
			parentId: parentRules.parentId,
		})
		.from(parentRules)
		.all()
		.map((r) => ({
			childKind: r.childKind,
			childId: r.childId ?? r.childCharacterId!,
			parentId: r.parentId,
		}))
}
