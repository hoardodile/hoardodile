/**
 * Pure, side-effect-free rule graph for tag siblings and parents (M1 part
 * of the tag-system rewrite: the pair tables exist and merge must migrate
 * rules correctly, so the graph logic is built and unit-tested now; the
 * rule-creation surface lands with M2/M3).
 *
 * Two directed rule sets live in this module:
 *
 * - Sibling pairs `bad → good`: the bad side (a tag or a character — a
 *   character links to a tag) is a synonym of `good` and every occurrence
 *   of the bad endpoint renders as `good`. A bad endpoint has at most one
 *   outgoing edge (uniqueness enforced by the pair PK); a tag's sibling
 *   group is the reverse-closure of its display tag (the graph root it
 *   reaches). Characters are always leaves: they can be bad endpoints but
 *   never targets, so they can never form cycles.
 * - Parent rules `child → parent`: entries carrying the child (a tag or a
 *   character) virtually have `parent`, transitively. The graph must stay
 *   acyclic; character children are leaves too.
 *
 * Endpoint maps are keyed by `(kind, id)` so tag and character ids never
 * collide (both are UUIDs from the same generator).
 *
 * Both graphs are small (rules are rare) and are rebuilt from the pair
 * tables on every request; everything here is a pure function over plain
 * arrays so it can be table-driven tested in isolation.
 */

export type EndpointKind = "tag" | "character"

export type SiblingPair = {
	/** The bad side's entity kind: a character link, or a tag synonym. */
	readonly badKind: EndpointKind
	/** Id of the bad endpoint (a tag or a character id). */
	readonly badId: string
	/** The display tag every occurrence of the bad side renders as. */
	readonly goodId: string
}

export type ParentRule = {
	readonly childKind: EndpointKind
	/** Id of the child endpoint (a tag or a character id). */
	readonly childId: string
	readonly parentId: string
}

export type SiblingPairs = ReadonlyMap<string, string>

/** Map key for an endpoint — `(kind, id)` keeps the two id spaces apart. */
export function endpointKey(kind: EndpointKind, id: string): string {
	return `${kind}:${id}`
}

/** Build the `bad → good` lookup map from the pair list. */
export function buildSiblingPairs(pairs: readonly SiblingPair[]): SiblingPairs {
	const map = new Map<string, string>()
	for (const pair of pairs)
		map.set(endpointKey(pair.badKind, pair.badId), pair.goodId)
	return map
}

/**
 * Whether the sibling graph contains a cycle (a tag that transitively
 * points back to itself). Characters are leaves (never targets), so they
 * only participate through their outgoing edge. Corrupt input: the app
 * never creates cycles, so a cycle means manually-edited data; consumers
 * degrade instead of hanging.
 */
export function hasSiblingCycle(pairs: readonly SiblingPair[]): boolean {
	const map = buildSiblingPairs(pairs)
	const visited = new Set<string>()
	for (const key of map.keys()) {
		if (visited.has(key)) continue
		const path = new Set<string>()
		let cur: string | undefined = key
		while (cur !== undefined) {
			if (path.has(cur)) return true
			if (visited.has(cur)) break
			visited.add(cur)
			path.add(cur)
			const good = map.get(cur)
			cur = good === undefined ? undefined : endpointKey("tag", good)
		}
	}
	return false
}

/**
 * The tag that `tagId` displays as: follow sibling pairs to the graph
 * root. Returns `undefined` when the tag belongs to no sibling group (no
 * pair involves it) or when the graph is cyclic.
 */
export function siblingDisplayOf(
	pairs: readonly SiblingPair[],
	tagId: string,
): string | undefined {
	const map = buildSiblingPairs(pairs)
	if (!map.has(endpointKey("tag", tagId)) && !hasAsGood(pairs, tagId)) {
		return undefined
	}
	const path = new Set<string>()
	let cur: string | undefined = endpointKey("tag", tagId)
	let last = tagId
	while (cur !== undefined) {
		if (path.has(cur)) return undefined
		path.add(cur)
		const good = map.get(cur)
		if (good === undefined) break
		last = good
		cur = endpointKey("tag", good)
	}
	return last
}

function hasAsGood(pairs: readonly SiblingPair[], tagId: string): boolean {
	for (const pair of pairs) {
		if (pair.goodId === tagId) return true
	}
	return false
}

/**
 * The display tag a character links to: its own pair's target, followed
 * through the tag chain. `undefined` when the character has no link.
 */
export function charSiblingDisplayOf(
	pairs: readonly SiblingPair[],
	charId: string,
): string | undefined {
	const map = buildSiblingPairs(pairs)
	const good = map.get(endpointKey("character", charId))
	if (good === undefined) return undefined
	return siblingDisplayOf(pairs, good) ?? good
}

/**
 * Every member of `tagId`'s sibling group (the reverse-closure of its
 * display tag), including the tag itself. Character members (characters
 * whose link chain reaches the group's display) are included as raw ids —
 * consumers split them via {@link charMemberIdsOf}. An ungrouped tag
 * yields a singleton set; a cyclic graph yields the tag's own chain.
 */
export function siblingGroupOf(
	pairs: readonly SiblingPair[],
	tagId: string,
): ReadonlySet<string> {
	const map = buildSiblingPairs(pairs)
	const display = siblingDisplayOf(pairs, tagId)
	if (display === undefined) {
		const members = new Set<string>()
		const path = new Set<string>()
		let cur: string | undefined = endpointKey("tag", tagId)
		while (cur !== undefined && !path.has(cur)) {
			path.add(cur)
			const good = map.get(cur)
			if (good === undefined) break
			members.add(good)
			cur = endpointKey("tag", good)
		}
		for (const pair of pairs) {
			if (pair.goodId === tagId) members.add(pair.badId)
		}
		members.add(tagId)
		return members
	}
	// Reverse closure from the display tag: everyone who (transitively)
	// points at it. Each bad endpoint has at most one outgoing pair, so
	// walking reversed edges from the root collects the whole group.
	const members = new Set<string>([display])
	let changed = true
	while (changed) {
		changed = false
		for (const pair of pairs) {
			if (members.has(pair.goodId) && !members.has(pair.badId)) {
				members.add(pair.badId)
				changed = true
			}
		}
	}
	return members
}

/**
 * The character members of a sibling group: every character whose link
 * chain displays as `displayTagId`.
 */
export function charMemberIdsOf(
	pairs: readonly SiblingPair[],
	displayTagId: string,
): ReadonlySet<string> {
	const members = new Set<string>()
	for (const pair of pairs) {
		if (pair.badKind !== "character") continue
		if (charSiblingDisplayOf(pairs, pair.badId) === displayTagId) {
			members.add(pair.badId)
		}
	}
	return members
}

/**
 * Migrate sibling pairs for a `source → target` merge. Group-union
 * semantics: the source's group is absorbed into the target's, so every
 * member of the source group (tags and characters alike) displays as the
 * target group's display tag (the target group keeps its own display).
 * The source's own pair dies with the source; an ungrouped source becomes
 * a direct member of the target group.
 *
 * Returns the rewritten pair list and how many pairs changed or were
 * added. On cyclic (corrupt) input the migration degrades to repointing
 * only the pairs that mention the source.
 */
export function migrateSiblingPairsForMerge(
	pairs: readonly SiblingPair[],
	sourceId: string,
	targetId: string,
): { readonly pairs: SiblingPair[]; readonly movedCount: number } {
	if (hasSiblingCycle(pairs)) {
		const result: SiblingPair[] = []
		let movedCount = 0
		for (const pair of pairs) {
			if (pair.badId === sourceId) continue
			if (pair.goodId === sourceId) {
				result.push({ ...pair, goodId: targetId })
				movedCount++
			} else {
				result.push(pair)
			}
		}
		return { pairs: result, movedCount }
	}
	const sourceDisplay = siblingDisplayOf(pairs, sourceId)
	const targetDisplay = siblingDisplayOf(pairs, targetId)
	if (sourceDisplay !== undefined && sourceDisplay === targetDisplay) {
		// Already one group: dropping the source's pair suffices.
		return {
			pairs: pairs.filter((pair) => pair.badId !== sourceId),
			movedCount: 0,
		}
	}
	const unionTarget = targetDisplay ?? targetId
	const group =
		sourceDisplay === undefined
			? new Set<string>([sourceId])
			: siblingGroupOf(pairs, sourceId)
	const result: SiblingPair[] = []
	let movedCount = 0
	for (const pair of pairs) {
		if (pair.badId === sourceId) continue
		if (group.has(pair.badId)) {
			result.push({ ...pair, goodId: unionTarget })
			movedCount++
		} else {
			result.push(pair)
		}
	}
	// The source group's display tag becomes a plain member of the target
	// group; an ungrouped source joins it directly. Both links point at
	// the surviving target, never at the deleted source.
	if (sourceDisplay === undefined) {
		result.push({ badKind: "tag", badId: sourceId, goodId: unionTarget })
		movedCount++
	} else if (sourceDisplay !== sourceId) {
		result.push({
			badKind: "tag",
			badId: sourceDisplay,
			goodId: unionTarget,
		})
		movedCount++
	}
	return { pairs: result, movedCount }
}

/**
 * Repoint a sibling group after its display tag is deleted: every member
 * of the group (anyone who transitively displayed as `displayId`) is
 * re-linked to the best remaining *tag* member — most-used, earliest
 * created wins ties — which becomes the group's new display. Character
 * members are never display candidates; they are re-linked to the new
 * display. Pairs whose bad is the deleted tag die with it; members of a
 * *corrupt* (cyclic) graph degrade to keeping their own pairs.
 *
 * `usageOf` / `createdAtOf` resolve the re-election tie-breakers; the
 * deleted tag itself never survives as a target.
 */
export function repointSiblingGroupOnDisplayDelete(
	pairs: readonly SiblingPair[],
	displayId: string,
	usageOf: (tagId: string) => number,
	createdAtOf: (tagId: string) => number,
): readonly SiblingPair[] {
	if (hasSiblingCycle(pairs)) {
		return pairs.filter((pair) => pair.badId !== displayId)
	}
	const group = siblingGroupOf(pairs, displayId)
	const charIds = charMemberIdsOf(pairs, displayId)
	const members = [...group].filter(
		(id) => id !== displayId && !charIds.has(id),
	)
	if (members.length === 0) {
		// No remaining tag to re-elect: the group dissolves.
		return pairs.filter((pair) => pair.goodId !== displayId)
	}
	const next = members.reduce((best, id) => {
		const usage = usageOf(id)
		const bestUsage = usageOf(best)
		if (usage > bestUsage) return id
		if (usage < bestUsage) return best
		if (createdAtOf(id) < createdAtOf(best)) return id
		if (createdAtOf(id) > createdAtOf(best)) return best
		return id < best ? id : best
	})
	const result: SiblingPair[] = []
	for (const pair of pairs) {
		if (pair.badId === displayId) continue
		if (group.has(pair.badId)) {
			// Every remaining member links straight to the new display.
			if (pair.badId !== next) {
				result.push({ ...pair, goodId: next })
			}
		} else {
			result.push(pair)
		}
	}
	return result
}

/**
 * Detect a cycle in the parent rule graph. Returns the offending path
 * (`a → b → a`) or `undefined` when the graph is acyclic. Character
 * children are leaves (never parents), so they cannot form cycles.
 */
export function findParentRuleCycle(
	rules: readonly ParentRule[],
): readonly string[] | undefined {
	const map = new Map<string, string>()
	for (const rule of rules) {
		map.set(endpointKey(rule.childKind, rule.childId), rule.parentId)
	}
	// Iterative DFS with explicit state (parent rules can chain deeply).
	const visited = new Set<string>()
	const inStack = new Set<string>()
	const stack: string[] = []
	for (const childKey of map.keys()) {
		if (visited.has(childKey)) continue
		stack.push(childKey)
		while (stack.length > 0) {
			const cur = stack[stack.length - 1] as string
			const next = map.get(cur)
			if (next === undefined || visited.has(endpointKey("tag", next))) {
				visited.add(cur)
				inStack.delete(cur)
				stack.pop()
				continue
			}
			const nextKey = endpointKey("tag", next)
			if (inStack.has(nextKey)) {
				const from = stack.indexOf(nextKey)
				// Cycle paths only ever contain tag endpoints (characters
				// are leaves) — report bare tag ids.
				return [...stack.slice(from), nextKey].map((key) =>
					key.slice("tag:".length),
				)
			}
			inStack.add(cur)
			stack.push(nextKey)
		}
	}
	return undefined
}

/**
 * Migrate parent rules for a `source → target` merge: every rule whose
 * tag child or parent is the source is repointed at the target, duplicate
 * rules are collapsed, and the resulting graph is cycle-checked. The
 * caller blocks the merge when `cycle` is present.
 */
export function migrateParentRulesForMerge(
	rules: readonly ParentRule[],
	sourceId: string,
	targetId: string,
): {
	readonly rules: ParentRule[]
	readonly movedCount: number
	readonly cycle?: readonly string[]
} {
	const migrated: ParentRule[] = []
	let movedCount = 0
	for (const rule of rules) {
		const childId =
			rule.childKind === "tag" && rule.childId === sourceId
				? targetId
				: rule.childId
		const parentId = rule.parentId === sourceId ? targetId : rule.parentId
		if (childId !== rule.childId || parentId !== rule.parentId) movedCount++
		// A repointed rule that collapses into itself (`x → x`) is
		// meaningless; drop it instead of blocking the merge.
		if (childId === parentId && rule.childKind === "tag") continue
		migrated.push({ childKind: rule.childKind, childId, parentId })
	}
	// Collapse duplicates (the PK is (child kind, child, parent)); keep
	// first occurrence.
	const seen = new Set<string>()
	const deduped: ParentRule[] = []
	for (const rule of migrated) {
		const key = `${endpointKey(rule.childKind, rule.childId)}\u0000${rule.parentId}`
		if (seen.has(key)) continue
		seen.add(key)
		deduped.push(rule)
	}
	return {
		rules: deduped,
		movedCount,
		cycle: findParentRuleCycle(deduped),
	}
}

/**
 * Kind-set guard shared by sibling and parent rule creation: a rule's
 * (transitively merged) group may only contain one kind plus `common`.
 * `{common, resource}` and `{common, character}` are allowed; anything
 * mixing resource and character is not. Character entities count as
 * `character` for this guard, so they may join `common`/character-kind
 * rules but never resource-kind ones.
 */
export function isKindSetAllowed(kinds: ReadonlySet<string>): boolean {
	let nonCommon: string | undefined
	for (const kind of kinds) {
		if (kind === "common") continue
		if (nonCommon !== undefined && nonCommon !== kind) return false
		nonCommon = kind
	}
	return true
}
