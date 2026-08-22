import type { TagFilterMode } from "@hoardodile/shared"
import { and, eq, exists, inArray, not, or, type SQL, sql } from "drizzle-orm"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"
import type { DbClient } from "src/infra/db/connection.ts"
import {
	charMemberIdsOf,
	charSiblingDisplayOf,
	type ParentRule,
	type SiblingPair,
	siblingDisplayOf,
	siblingGroupOf,
} from "./rules.ts"
import { parentRules, siblingPairs } from "./schema.ts"

/**
 * Inputs to {@link buildTagFilterClauses}: the entity-tag join table
 * description plus the active filter (selected tag ids and mode).
 *
 * `entityIdColumn` and `tagIdColumn` MUST come from the same join
 * table (`resTags.resId` + `resTags.tagId` or
 * `charTags.charId` + `charTags.tagId`).
 *
 * `outerEntityIdColumn` is the parent table's primary key reference
 * used inside the EXISTS subquery's `WHERE` clause to correlate it
 * back to the outer query (e.g. `resources.id`).
 *
 * Character members of a sibling group extend the match: a resource
 * carries the group via `characterJoin` (e.g. `resCharacters`); a
 * character list matches via `selfCharacterIdColumn` (the entity IS a
 * group member).
 */
export type TagFilterInputs = {
	readonly db: DbClient
	readonly entityIdColumn: AnySQLiteColumn
	readonly tagIdColumn: AnySQLiteColumn
	readonly outerEntityIdColumn: AnySQLiteColumn
	readonly tagIds: readonly string[]
	readonly tagMode: TagFilterMode | undefined
	/** EXISTS over an entity→character join table (resource lists). */
	readonly characterJoin?: {
		readonly entityIdColumn: AnySQLiteColumn
		readonly charIdColumn: AnySQLiteColumn
		readonly outerEntityIdColumn: AnySQLiteColumn
	}
	/** Self-membership column (character lists: the entity IS the member). */
	readonly selfCharacterIdColumn?: AnySQLiteColumn
}

/**
 * Compose the WHERE-clause fragments that implement the per-tag filter
 * for an entity list query. Returns an empty array when no tag filter
 * is active so the caller can spread directly into its `clauses`
 * accumulator.
 *
 * Sibling groups are expanded here (the PRD's filter-input layer): each
 * selected tag id stands for its whole group, so picking any member
 * matches entries carrying any member — including character members,
 * which match through the character join (or self-membership).
 *
 * Modes:
 * - `"and"` (default): one EXISTS per selected tag - entity must carry
 *   every selected group.
 * - `"or"`: a single EXISTS with `IN (...)` - entity carries any group.
 * - `"not"` / `"nor"`: NOT EXISTS with `IN (...)` - entity carries
 *   none of the selected groups. Both modes are SQL-equivalent today;
 *   the toggle separates them only because the UI surfaces both
 *   labels (logical complements of `and`/`or` respectively). Keep
 *   them as one branch so the implementation stays a single source
 *   of truth.
 */
export function buildTagFilterClauses(inputs: TagFilterInputs): SQL[] {
	const {
		db,
		entityIdColumn,
		tagIdColumn,
		outerEntityIdColumn,
		tagIds,
		tagMode,
	} = inputs
	if (tagIds.length === 0) return []
	const mode = tagMode ?? "and"
	const groups = expandGroups(db, tagIds)
	const groupClause = (group: ExpandedGroup): SQL => {
		const conditions: SQL[] = [
			exists(
				db
					.select({ one: sql`1` })
					.from(entityIdColumn.table)
					.where(
						and(
							eq(entityIdColumn, outerEntityIdColumn),
							inArray(tagIdColumn, group.tagIds),
						),
					),
			),
		]
		if (group.characterIds.length > 0) {
			if (inputs.characterJoin !== undefined) {
				conditions.push(
					exists(
						db
							.select({ one: sql`1` })
							.from(inputs.characterJoin.entityIdColumn.table)
							.where(
								and(
									eq(
										inputs.characterJoin.entityIdColumn,
										inputs.characterJoin.outerEntityIdColumn,
									),
									inArray(
										inputs.characterJoin.charIdColumn,
										group.characterIds,
									),
								),
							),
					),
				)
			}
			if (inputs.selfCharacterIdColumn !== undefined) {
				conditions.push(
					inArray(inputs.selfCharacterIdColumn, group.characterIds),
				)
			}
		}
		return conditions.length === 1 ? conditions[0]! : or(...conditions)!
	}
	if (mode === "or") {
		return [
			or(
				...groups.map((group) =>
					exists(
						db
							.select({ one: sql`1` })
							.from(entityIdColumn.table)
							.where(
								and(
									eq(entityIdColumn, outerEntityIdColumn),
									inArray(tagIdColumn, group.tagIds),
								),
							),
					),
				),
				...characterConditions(db, inputs, groups),
			)!,
		]
	}
	if (mode === "not" || mode === "nor") {
		return [
			not(
				or(
					...groups.map((group) =>
						exists(
							db
								.select({ one: sql`1` })
								.from(entityIdColumn.table)
								.where(
									and(
										eq(entityIdColumn, outerEntityIdColumn),
										inArray(tagIdColumn, group.tagIds),
									),
								),
						),
					),
					...characterConditions(db, inputs, groups),
				)!,
			),
		]
	}
	// "and": one clause per selected tag - entity must carry every group.
	return groups.map(groupClause)
}

/**
 * Character-membership SQL fragments shared by the `or` / `not` modes:
 * one EXISTS per join-table description over the union of the groups'
 * character ids, plus a self-membership IN for character lists.
 */
function characterConditions(
	db: DbClient,
	inputs: TagFilterInputs,
	groups: readonly ExpandedGroup[],
): SQL[] {
	const allCharacterIds = [
		...new Set(groups.flatMap((group) => group.characterIds)),
	]
	if (allCharacterIds.length === 0) return []
	const conditions: SQL[] = []
	if (inputs.characterJoin !== undefined) {
		conditions.push(
			exists(
				db
					.select({ one: sql`1` })
					.from(inputs.characterJoin.entityIdColumn.table)
					.where(
						and(
							eq(
								inputs.characterJoin.entityIdColumn,
								inputs.characterJoin.outerEntityIdColumn,
							),
							inArray(inputs.characterJoin.charIdColumn, allCharacterIds),
						),
					),
			),
		)
	}
	if (inputs.selfCharacterIdColumn !== undefined) {
		conditions.push(inArray(inputs.selfCharacterIdColumn, allCharacterIds))
	}
	return conditions
}

/** One expanded group: the tag ids and character ids an entry may carry. */
type ExpandedGroup = {
	readonly tagIds: readonly string[]
	readonly characterIds: readonly string[]
}

/**
 * Expand each selected tag id to the sets an entry may carry and still
 * match: its sibling group (tags + character members) plus the sibling
 * groups of every parent descendant (M3: searching a parent matches
 * entries with the parent or any descendant — searching a child does NOT
 * match parent-only entries, so only the selected group's own members
 * expand downward).
 */
function expandGroups(
	db: DbClient,
	tagIds: readonly string[],
): readonly ExpandedGroup[] {
	const pairs: readonly SiblingPair[] = db
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
	const rules: readonly ParentRule[] = db
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
	const childrenOf = new Map<
		string,
		{ kind: "tag" | "character"; id: string }[]
	>()
	for (const rule of rules) {
		const list = childrenOf.get(rule.parentId) ?? []
		list.push({ kind: rule.childKind, id: rule.childId })
		childrenOf.set(rule.parentId, list)
	}
	const toDisplay = (id: string) => siblingDisplayOf(pairs, id) ?? id
	return tagIds.map((id) => {
		const displays = new Set<string>([toDisplay(id)])
		const loneCharacters = new Set<string>()
		const stack = [...(childrenOf.get(id) ?? [])]
		while (stack.length > 0) {
			const child = stack.pop()
			if (child === undefined) continue
			if (child.kind === "character") {
				const display = charSiblingDisplayOf(pairs, child.id)
				if (display === undefined) {
					// A character child without a sibling link carries the
					// rule on its own: it matches as a lone member.
					loneCharacters.add(child.id)
				} else if (!displays.has(display)) {
					displays.add(display)
					stack.push(...(childrenOf.get(display) ?? []))
				}
				continue
			}
			const display = toDisplay(child.id)
			if (displays.has(display)) continue
			displays.add(display)
			stack.push(...(childrenOf.get(display) ?? []))
		}
		// Collect every group member (tags and character links) of every
		// display the selection expands to, plus lone character children.
		const tagMembers = new Set<string>()
		const characterMembers = new Set<string>(loneCharacters)
		for (const display of displays) {
			const chars = charMemberIdsOf(pairs, display)
			for (const c of chars) characterMembers.add(c)
			for (const member of siblingGroupOf(pairs, display)) {
				if (!chars.has(member)) tagMembers.add(member)
			}
		}
		return {
			tagIds: [...tagMembers],
			characterIds: [...characterMembers],
		}
	})
}
