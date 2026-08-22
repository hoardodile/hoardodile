import { describe, expect, test } from "vitest"
import {
	docCommitInput,
	docDraftPatchInput,
	docMoveBatchInput,
	docNode,
	docSearchInput,
	docVersion,
} from "./doc.ts"

describe("docNode", () => {
	const valid = {
		id: "doc_1",
		kind: "document" as const,
		title: "Untitled",
		position: 0,
		createdAt: 1,
		updatedAt: 2,
	}

	test("parent omitted = root child", () => {
		const parsed = docNode.parse(valid)
		expect(parsed.parentId).toBeUndefined()
	})

	test("rejects empty title", () => {
		expect(docNode.safeParse({ ...valid, title: "" }).success).toBe(false)
	})
})

describe("docVersion", () => {
	test("versionNo must be positive", () => {
		const ok = {
			id: "v1",
			docId: "d1",
			versionNo: 1,
			title: "t",
			content: { type: "doc" },
			charIds: [],
			resIds: [],
			message: "",
			createdAt: 1,
		}
		expect(docVersion.safeParse(ok).success).toBe(true)
		expect(docVersion.safeParse({ ...ok, versionNo: 0 }).success).toBe(false)
	})
})

describe("inputs", () => {
	test("docDraftPatchInput allows partial updates", () => {
		expect(docDraftPatchInput.safeParse({ id: "d1", title: "x" }).success).toBe(
			true,
		)
		expect(docDraftPatchInput.safeParse({ id: "d1" }).success).toBe(true)
	})

	test("docMoveBatchInput requires at least one move", () => {
		expect(docMoveBatchInput.safeParse({ moves: [] }).success).toBe(false)
		expect(
			docMoveBatchInput.safeParse({
				moves: [{ id: "n1", position: 0 }],
			}).success,
		).toBe(true)
	})

	test("docSearchInput accepts char and res filters", () => {
		expect(
			docSearchInput.safeParse({
				query: "x",
				charIds: ["c1"],
				resIds: ["r1"],
			}).success,
		).toBe(true)
	})

	test("docCommitInput message is optional", () => {
		expect(docCommitInput.safeParse({ id: "d1" }).success).toBe(true)
	})
})
