/**
 * @vitest-environment node
 */

import { describe, expect, test } from "vitest"
import { computeCommonAndNonCommonTagIds, computeTagDiff } from "./bulkTagCalc"

function mockTag(id: string): { id: string; name: string } {
	return { id, name: `Tag-${id}` }
}

function mockQuery(data: readonly { id: string; name: string }[]) {
	return { data }
}

describe("computeCommonAndNonCommonTagIds", () => {
	test("empty queries → empty result", () => {
		const result = computeCommonAndNonCommonTagIds([])
		expect(result.commonTagIds).toEqual([])
		expect(result.nonCommonTagIds).toEqual([])
	})

	test("single entity → all tags are common", () => {
		const result = computeCommonAndNonCommonTagIds([
			mockQuery([mockTag("t1"), mockTag("t2")]),
		])
		expect(result.commonTagIds).toEqual(["t1", "t2"])
		expect(result.nonCommonTagIds).toEqual([])
	})

	test("two entities with identical tags → all common", () => {
		const result = computeCommonAndNonCommonTagIds([
			mockQuery([mockTag("t1"), mockTag("t2")]),
			mockQuery([mockTag("t1"), mockTag("t2")]),
		])
		expect(result.commonTagIds).toEqual(["t1", "t2"])
		expect(result.nonCommonTagIds).toEqual([])
	})

	test("two entities with partial overlap → intersection is common", () => {
		const result = computeCommonAndNonCommonTagIds([
			mockQuery([mockTag("t1"), mockTag("t2"), mockTag("t3")]),
			mockQuery([mockTag("t1"), mockTag("t2"), mockTag("t4")]),
		])
		expect(result.commonTagIds).toEqual(["t1", "t2"])
		expect(result.nonCommonTagIds).toEqual(["t3", "t4"])
	})

	test("two entities with no overlap → nothing common", () => {
		const result = computeCommonAndNonCommonTagIds([
			mockQuery([mockTag("t1")]),
			mockQuery([mockTag("t2")]),
		])
		expect(result.commonTagIds).toEqual([])
		expect(result.nonCommonTagIds).toEqual(["t1", "t2"])
	})

	test("three entities → intersection of all three", () => {
		const result = computeCommonAndNonCommonTagIds([
			mockQuery([mockTag("t1"), mockTag("t2")]),
			mockQuery([mockTag("t1"), mockTag("t3")]),
			mockQuery([mockTag("t1"), mockTag("t4")]),
		])
		expect(result.commonTagIds).toEqual(["t1"])
		expect(result.nonCommonTagIds).toEqual(["t2", "t3", "t4"])
	})

	test("handles undefined data gracefully", () => {
		const result = computeCommonAndNonCommonTagIds([
			mockQuery([mockTag("t1")]),
			{ data: undefined },
		])
		expect(result.commonTagIds).toEqual([])
		expect(result.nonCommonTagIds).toEqual(["t1"])
	})
})

describe("computeTagDiff", () => {
	test("no changes → empty attach and detach", () => {
		const result = computeTagDiff(["t1", "t2"], ["t1", "t2"])
		expect(result.toAttach).toEqual([])
		expect(result.toDetach).toEqual([])
	})

	test("adds new tag → toAttach contains it", () => {
		const result = computeTagDiff(["t1"], ["t1", "t2"])
		expect(result.toAttach).toEqual(["t2"])
		expect(result.toDetach).toEqual([])
	})

	test("removes common tag → toDetach contains it", () => {
		const result = computeTagDiff(["t1", "t2"], ["t1"])
		expect(result.toAttach).toEqual([])
		expect(result.toDetach).toEqual(["t2"])
	})

	test("add and remove simultaneously", () => {
		const result = computeTagDiff(["t1", "t2"], ["t1", "t3"])
		expect(result.toAttach).toEqual(["t3"])
		expect(result.toDetach).toEqual(["t2"])
	})

	test("selecting a non-common tag → toAttach contains it", () => {
		// commonTagIds only contains t1, user selects t1 + t3 (t3 is non-common)
		const result = computeTagDiff(["t1"], ["t1", "t3"])
		expect(result.toAttach).toEqual(["t3"])
		expect(result.toDetach).toEqual([])
	})

	test("deselecting a tag that was never common → no detach", () => {
		// user selected t3 (non-common) then deselected it before saving
		const result = computeTagDiff(["t1"], ["t1"])
		expect(result.toAttach).toEqual([])
		expect(result.toDetach).toEqual([])
	})

	test("removing all tags → all common tags detached", () => {
		const result = computeTagDiff(["t1", "t2"], [])
		expect(result.toAttach).toEqual([])
		expect(result.toDetach).toEqual(["t1", "t2"])
	})
})
