/**
 * @vitest-environment node
 */

import { BlockNoteEditor } from "@blocknote/core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { blocksToDoc } from "../../diffCompute.ts"
import { docSchema } from "../schema.ts"
import { findMatches } from "./findMatches.ts"

type TestEditor = ReturnType<
	typeof BlockNoteEditor.create<{ schema: typeof docSchema }>
>

describe("findMatches", () => {
	let editor: TestEditor

	/** ProseMirror document from plain paragraphs of text. */
	function docOf(...texts: string[]) {
		return blocksToDoc(
			editor._tiptapEditor.state.schema,
			texts.map((text) => ({ type: "paragraph", content: text })),
		)
	}

	beforeAll(() => {
		editor = BlockNoteEditor.create({ schema: docSchema })
	})

	afterAll(() => {
		editor._tiptapEditor.destroy()
	})

	it("returns no matches for an empty or whitespace-only query", () => {
		const doc = docOf("alpha beta")
		expect(findMatches(doc, "", { caseSensitive: false })).toEqual([])
		expect(findMatches(doc, "   ", { caseSensitive: false })).toEqual([])
	})

	it("matches case-insensitively by default and exactly when asked", () => {
		const doc = docOf("Alpha alpha ALPHA")

		expect(findMatches(doc, "alpha", { caseSensitive: false })).toHaveLength(3)
		expect(findMatches(doc, "alpha", { caseSensitive: true })).toHaveLength(1)
	})

	it("reports ranges whose document text is the query", () => {
		const doc = docOf("hello world")
		const [match] = findMatches(doc, "world", { caseSensitive: false })
		expect(match).toBeDefined()
		expect(doc.textBetween(match!.from, match!.to)).toBe("world")
	})

	it("finds matches in every text node of the body", () => {
		const doc = docOf("one cat", "two cat", "three cat")
		const matches = findMatches(doc, "cat", { caseSensitive: false })
		expect(matches).toHaveLength(3)
		for (const match of matches) {
			expect(doc.textBetween(match.from, match.to)).toBe("cat")
		}
	})

	it("treats regex metacharacters literally", () => {
		const doc = docOf("a (b) c.d *e*")
		for (const literal of ["(b)", "c.d", "*e*"]) {
			const [match] = findMatches(doc, literal, { caseSensitive: false })
			expect(doc.textBetween(match!.from, match!.to)).toBe(literal)
		}
		// A pattern that would match structurally must not match as text.
		expect(findMatches(doc, "b|c", { caseSensitive: false })).toEqual([])
	})

	it("does not match across inline content boundaries", () => {
		// "cat" split by a character chip: the halves are separate text
		// nodes, so no contiguous "cat" exists in any single node.
		const doc = blocksToDoc(editor._tiptapEditor.state.schema, [
			{
				type: "paragraph",
				content: [
					{ type: "text", text: "ca" },
					{
						type: "charChip",
						props: { charId: "char-1", fallbackName: "X" },
					},
					{ type: "text", text: "t" },
				],
			},
		])

		expect(findMatches(doc, "cat", { caseSensitive: false })).toEqual([])
	})

	it("skips overlapping occurrences", () => {
		const doc = docOf("aaaa")
		// Non-overlapping scan: the second match starts after the first.
		const matches = findMatches(doc, "aa", { caseSensitive: false })
		expect(matches).toHaveLength(2)
		expect(matches[1]!.from - matches[0]!.from).toBe(2)
	})
})
