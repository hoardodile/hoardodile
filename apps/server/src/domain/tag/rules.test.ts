import { describe, expect, test } from "vitest"
import {
	charMemberIdsOf,
	charSiblingDisplayOf,
	findParentRuleCycle,
	hasSiblingCycle,
	isKindSetAllowed,
	migrateParentRulesForMerge,
	migrateSiblingPairsForMerge,
	type ParentRule,
	repointSiblingGroupOnDisplayDelete,
	type SiblingPair,
	siblingDisplayOf,
	siblingGroupOf,
} from "./rules.ts"

function pair(bad: string, good: string): SiblingPair {
	return { badKind: "tag", badId: bad, goodId: good }
}

function charPair(char: string, good: string): SiblingPair {
	return { badKind: "character", badId: char, goodId: good }
}

function rule(child: string, parent: string): ParentRule {
	return { childKind: "tag", childId: child, parentId: parent }
}

function charRule(child: string, parent: string): ParentRule {
	return { childKind: "character", childId: child, parentId: parent }
}

const A = "a"
const B = "b"
const C = "c"
const D = "d"
const E = "e"
const F = "f"
const S = "s"
const T = "t"
const X = "x-char"
const Y = "y-char"

describe("siblingDisplayOf", () => {
	test("ungrouped tag has no display", () => {
		expect(siblingDisplayOf([], A)).toBeUndefined()
		expect(siblingDisplayOf([pair(B, C)], A)).toBeUndefined()
	})

	test("a good-only tag is its own display", () => {
		expect(siblingDisplayOf([pair(B, A)], A)).toBe(A)
	})

	test("follows the pair chain to the root", () => {
		const pairs = [pair(A, B), pair(B, C)]
		expect(siblingDisplayOf(pairs, A)).toBe(C)
		expect(siblingDisplayOf(pairs, B)).toBe(C)
		expect(siblingDisplayOf(pairs, C)).toBe(C)
	})

	test("returns undefined on a cycle instead of hanging", () => {
		expect(siblingDisplayOf([pair(A, B), pair(B, A)], A)).toBeUndefined()
	})
})

describe("hasSiblingCycle", () => {
	test("chains are acyclic", () => {
		expect(hasSiblingCycle([pair(A, B), pair(B, C)])).toBe(false)
	})

	test("detects a two-node cycle", () => {
		expect(hasSiblingCycle([pair(A, B), pair(B, A)])).toBe(true)
	})

	test("detects a longer cycle", () => {
		expect(hasSiblingCycle([pair(A, B), pair(B, C), pair(C, A)])).toBe(true)
	})
})

describe("siblingGroupOf", () => {
	test("ungrouped tag is a singleton", () => {
		expect([...siblingGroupOf([pair(B, C)], A)]).toEqual([A])
	})

	test("collects the whole reverse closure", () => {
		const pairs = [pair(A, B), pair(B, C), pair(S, C)]
		expect([...siblingGroupOf(pairs, A)].sort()).toEqual([A, B, C, S])
		expect([...siblingGroupOf(pairs, S)].sort()).toEqual([A, B, C, S])
		expect([...siblingGroupOf(pairs, C)].sort()).toEqual([A, B, C, S])
	})
})

describe("migrateSiblingPairsForMerge", () => {
	test("merge of two ungrouped tags adds a pair pointing at the target", () => {
		const result = migrateSiblingPairsForMerge([], S, T)
		expect(result.pairs).toEqual([pair(S, T)])
		expect(result.movedCount).toBe(1)
	})

	test("merge absorbs the source group into the target group's display", () => {
		const pairs = [pair(A, S), pair(S, B), pair(C, T)]
		const result = migrateSiblingPairsForMerge(pairs, S, T)
		expect(result.pairs).toEqual([pair(A, T), pair(C, T), pair(B, T)])
		expect(result.movedCount).toBe(2)
	})

	test("source's own pair dies with the source", () => {
		const pairs = [pair(S, B), pair(A, S)]
		const result = migrateSiblingPairsForMerge(pairs, S, T)
		expect(result.pairs).toEqual([pair(A, T), pair(B, T)])
		expect(result.movedCount).toBe(2)
	})

	test("source display is a member; no pair references the deleted source", () => {
		const pairs = [pair(A, S)]
		const result = migrateSiblingPairsForMerge(pairs, S, T)
		expect(result.pairs).toEqual([pair(A, T)])
		expect(result.movedCount).toBe(1)
	})

	test("already in the same group: only the source pair is dropped", () => {
		const pairs = [pair(A, B), pair(S, B)]
		const result = migrateSiblingPairsForMerge(pairs, S, B)
		expect(result.pairs).toEqual([pair(A, B)])
		expect(result.movedCount).toBe(0)
	})

	test("cyclic graph degrades to repointing source-adjacent pairs", () => {
		const pairs = [pair(A, S), pair(S, B), pair(B, A)]
		const result = migrateSiblingPairsForMerge(pairs, S, T)
		expect(result.pairs).toEqual([pair(A, T), pair(B, A)])
		expect(result.movedCount).toBe(1)
	})
})

describe("findParentRuleCycle", () => {
	test("empty and linear chains have no cycle", () => {
		expect(findParentRuleCycle([])).toBeUndefined()
		expect(findParentRuleCycle([rule(A, B), rule(B, C)])).toBeUndefined()
	})

	test("detects a two-node cycle", () => {
		expect(findParentRuleCycle([rule(A, B), rule(B, A)])).toEqual([A, B, A])
	})

	test("detects a longer cycle", () => {
		expect(findParentRuleCycle([rule(A, B), rule(B, C), rule(C, A)])).toEqual([
			A,
			B,
			C,
			A,
		])
	})

	test("ignores a cycle-free branch next to a cyclic one", () => {
		const rules = [rule(A, B), rule(B, C), rule(C, B)]
		expect(findParentRuleCycle(rules)).toEqual([B, C, B])
	})
})

describe("migrateParentRulesForMerge", () => {
	test("repoints both sides of source-involving rules", () => {
		const rules = [rule(A, S), rule(S, B), rule(C, D)]
		const result = migrateParentRulesForMerge(rules, S, T)
		expect(result.rules).toEqual([rule(A, T), rule(T, B), rule(C, D)])
		expect(result.movedCount).toBe(2)
		expect(result.cycle).toBeUndefined()
	})

	test("collapses duplicates and drops self-loops created by the repoint", () => {
		const rules = [rule(A, S), rule(A, B), rule(S, B)]
		const result = migrateParentRulesForMerge(rules, S, B)
		expect(result.rules).toEqual([rule(A, B)])
		expect(result.cycle).toBeUndefined()
	})

	test("reports a cycle introduced by the repoint", () => {
		const rules = [rule(A, S), rule(B, A)]
		const result = migrateParentRulesForMerge(rules, S, B)
		expect(result.rules).toEqual([rule(A, B), rule(B, A)])
		expect(result.cycle).toEqual([A, B, A])
	})

	test("unrelated rules are untouched", () => {
		const rules = [rule(C, D), rule(E, F)]
		const result = migrateParentRulesForMerge(rules, S, T)
		expect(result.rules).toEqual(rules)
		expect(result.movedCount).toBe(0)
	})
})

describe("charSiblingDisplayOf", () => {
	test("unchained character has no display", () => {
		expect(charSiblingDisplayOf([], X)).toBeUndefined()
	})

	test("a character's link resolves to its group's display", () => {
		const pairs = [charPair(X, A), pair(A, B), pair(B, C)]
		expect(charSiblingDisplayOf(pairs, X)).toBe(C)
	})

	test("unlinked character is untouched by other pairs", () => {
		const pairs = [pair(A, B), charPair(X, A)]
		expect(charSiblingDisplayOf(pairs, Y)).toBeUndefined()
	})
})

describe("charMemberIdsOf", () => {
	test("collects characters whose chain displays as the tag", () => {
		const pairs = [charPair(X, A), charPair(Y, B), pair(B, A), pair(C, A)]
		expect([...charMemberIdsOf(pairs, A)].sort()).toEqual([X, Y])
		expect(charMemberIdsOf(pairs, C)).toEqual(new Set())
	})

	test("character chains through tag members count for the display", () => {
		const pairs = [charPair(X, B), pair(B, A)]
		expect([...charMemberIdsOf(pairs, A)]).toEqual([X])
	})
})

describe("sibling groups with character members", () => {
	test("characters ride the reverse closure and never become targets", () => {
		const pairs = [charPair(X, A), pair(B, A)]
		const group = siblingGroupOf(pairs, A)
		expect([...group].sort()).toEqual([A, B, X])
	})

	test("characters never form sibling cycles", () => {
		expect(
			hasSiblingCycle([charPair(X, A), charPair(Y, A), pair(A, B), pair(B, C)]),
		).toBe(false)
	})

	test("a tag chain cycle is still detected through character leaves", () => {
		expect(hasSiblingCycle([charPair(X, A), pair(A, B), pair(B, A)])).toBe(true)
	})

	test("a character pointing at a tag makes it a good-only display of the group", () => {
		const pairs = [charPair(X, A)]
		// A becomes a good — it displays as itself and the character rides
		// the reverse closure.
		expect(siblingDisplayOf(pairs, A)).toBe(A)
		expect([...siblingGroupOf(pairs, A)].sort()).toEqual([A, X])
		expect(charSiblingDisplayOf(pairs, X)).toBe(A)
	})

	test("merge absorbs character members into the target group", () => {
		const pairs = [charPair(X, S), pair(A, S), pair(B, T)]
		const result = migrateSiblingPairsForMerge(pairs, S, T)
		expect(result.pairs).toEqual([charPair(X, T), pair(A, T), pair(B, T)])
		expect(result.movedCount).toBe(2)
	})

	test("merging a display tag repoints its character members", () => {
		const pairs = [charPair(X, S), pair(A, S), pair(S, B)]
		const result = migrateSiblingPairsForMerge(pairs, S, T)
		expect(result.pairs).toEqual([charPair(X, T), pair(A, T), pair(B, T)])
	})

	test("cyclic degradation repoints character pairs mentioning the source", () => {
		const pairs = [charPair(X, S), pair(S, B), pair(B, A), pair(A, S)]
		const result = migrateSiblingPairsForMerge(pairs, S, T)
		expect(result.pairs).toEqual([charPair(X, T), pair(B, A), pair(A, T)])
		expect(result.movedCount).toBe(2)
	})
})

describe("repointSiblingGroupOnDisplayDelete with character members", () => {
	test("characters are re-linked but never elected display", () => {
		const pairs = [charPair(X, D), pair(A, D), pair(B, D)]
		const usage = (id: string) => (id === B ? 5 : id === X ? 99 : 0)
		const created = (id: string) => (id === A ? 1 : 2)
		const result = repointSiblingGroupOnDisplayDelete(pairs, D, usage, created)
		expect(result).toEqual([charPair(X, B), pair(A, B)])
	})

	test("a group of only a character and the display dissolves", () => {
		const pairs = [charPair(X, D)]
		expect(
			repointSiblingGroupOnDisplayDelete(
				pairs,
				D,
				() => 0,
				() => 1,
			),
		).toEqual([])
	})
})

describe("parent rules with character children", () => {
	test("character children are leaves: no cycles through them", () => {
		expect(
			findParentRuleCycle([charRule(X, A), rule(A, B), rule(B, A)]),
		).toEqual([A, B, A])
		expect(
			findParentRuleCycle([charRule(X, A), charRule(Y, A)]),
		).toBeUndefined()
	})

	test("merge repoints tag children and parents of the source", () => {
		const rules = [charRule(X, S), rule(S, B)]
		const result = migrateParentRulesForMerge(rules, S, T)
		expect(result.rules).toEqual([charRule(X, T), rule(T, B)])
		expect(result.cycle).toBeUndefined()
	})

	test("a char rule whose parent is the source repoints to the target", () => {
		const rules = [charRule(X, S), rule(B, C)]
		const result = migrateParentRulesForMerge(rules, S, T)
		expect(result.rules).toEqual([charRule(X, T), rule(B, C)])
	})

	test("char and tag children with the same id never collapse into each other", () => {
		// X names both a character child and a tag child (id collision
		// across entity kinds) — the dedupe key must carry the kind.
		const rules = [charRule(X, S), rule(X, S), charRule(X, T)]
		const result = migrateParentRulesForMerge(rules, S, T)
		expect(result.rules).toEqual([charRule(X, T), rule(X, T)])
		expect(result.cycle).toBeUndefined()
	})
})

describe("isKindSetAllowed", () => {
	test("single kind or common plus one kind is allowed", () => {
		expect(isKindSetAllowed(new Set(["common"]))).toBe(true)
		expect(isKindSetAllowed(new Set(["resource"]))).toBe(true)
		expect(isKindSetAllowed(new Set(["common", "resource"]))).toBe(true)
		expect(isKindSetAllowed(new Set(["common", "character"]))).toBe(true)
	})

	test("mixing resource and character is rejected", () => {
		expect(isKindSetAllowed(new Set(["common", "resource", "character"]))).toBe(
			false,
		)
		expect(isKindSetAllowed(new Set(["resource", "character"]))).toBe(false)
	})
})

describe("repointSiblingGroupOnDisplayDelete", () => {
	const D = "d"
	const usage = (id: string) => (id === B ? 5 : 0)
	const created = (id: string) => (id === A ? 1 : 2)
	const star = (pairs: readonly SiblingPair[]) =>
		pairs.filter((p) => p.badId !== p.goodId)

	test("re-elects the most-used remaining member as display", () => {
		const pairs = [pair(A, D), pair(B, D)]
		expect(
			repointSiblingGroupOnDisplayDelete(pairs, D, usage, created),
		).toEqual(star([pair(A, B)]))
	})

	test("chains flatten: every member links straight to the new display", () => {
		const pairs = [pair(A, B), pair(B, D)]
		expect(
			repointSiblingGroupOnDisplayDelete(pairs, D, usage, created),
		).toEqual(star([pair(A, B)]))
	})

	test("members with equal usage keep the earliest created", () => {
		const pairs = [pair(A, D), pair(C, D)]
		expect(
			repointSiblingGroupOnDisplayDelete(pairs, D, () => 0, created),
		).toEqual([pair(C, A)])
	})

	test("a lone display leaves the graph untouched", () => {
		expect(repointSiblingGroupOnDisplayDelete([], D, usage, created)).toEqual(
			[],
		)
	})

	test("cyclic graph degrades to dropping the tag's own pair", () => {
		const pairs = [pair(A, B), pair(B, A)]
		expect(
			repointSiblingGroupOnDisplayDelete(pairs, A, usage, created),
		).toEqual(pairs.filter((p) => p.badId !== A))
	})
})
