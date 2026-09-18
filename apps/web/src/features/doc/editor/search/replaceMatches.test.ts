/**
 * @vitest-environment node
 */

import { BlockNoteEditor } from "@blocknote/core"
import type { Node } from "prosemirror-model"
import { EditorState } from "prosemirror-state"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { blocksToDoc } from "../../diffCompute.ts"
import { docSchema } from "../schema.ts"
import { findMatches } from "./findMatches.ts"
import { buildReplaceTransaction } from "./replaceMatches.ts"

type TestEditor = ReturnType<
	typeof BlockNoteEditor.create<{ schema: typeof docSchema }>
>

describe("buildReplaceTransaction", () => {
	let editor: TestEditor

	function docOf(...texts: string[]) {
		return blocksToDoc(
			editor._tiptapEditor.state.schema,
			texts.map((text) => ({ type: "paragraph", content: text })),
		)
	}

	function textOf(doc: Node) {
		return doc.textBetween(0, doc.content.size, "\n")
	}

	function replaceIn(doc: Node, query: string, replacement: string) {
		const state = EditorState.create({
			schema: editor._tiptapEditor.state.schema,
			doc,
		})
		const ranges = findMatches(doc, query, { caseSensitive: false })
		return buildReplaceTransaction(state, ranges, replacement)
	}

	beforeAll(() => {
		editor = BlockNoteEditor.create({ schema: docSchema })
	})

	afterAll(() => {
		editor._tiptapEditor.destroy()
	})

	it("replaces a single match with the replacement text", () => {
		const tr = replaceIn(docOf("hello world"), "world", "there")
		expect(textOf(tr.doc)).toBe("hello there")
	})

	it("replaces every match in one transaction", () => {
		const doc = docOf("cat dog cat", "cat")
		const ranges = findMatches(doc, "cat", { caseSensitive: false })
		expect(ranges).toHaveLength(3)

		const state = EditorState.create({
			schema: editor._tiptapEditor.state.schema,
			doc,
		})
		const tr = buildReplaceTransaction(state, ranges, "bird")
		expect(tr.steps).toHaveLength(3)
		expect(textOf(tr.doc)).toBe("bird dog bird\nbird")
	})

	it("deletes matches when the replacement is empty", () => {
		const tr = replaceIn(docOf("keep drop keep"), "drop ", "")
		expect(textOf(tr.doc)).toBe("keep keep")
	})

	it("keeps the marks active at the match start", () => {
		const doc = blocksToDoc(editor._tiptapEditor.state.schema, [
			{
				type: "paragraph",
				content: [
					{ type: "text", text: "plain " },
					{ type: "text", text: "bold", styles: { bold: true } },
				],
			},
		])
		const tr = replaceIn(doc, "bold", "strong")

		let marked = ""
		tr.doc.descendants((node) => {
			if (!node.isText) return
			if (node.marks.some((mark) => mark.type.name === "bold")) {
				marked += node.text ?? ""
			}
		})
		expect(textOf(tr.doc)).toBe("plain strong")
		expect(marked).toBe("strong")
	})

	it("does not change the document when there is nothing to replace", () => {
		const tr = replaceIn(docOf("nothing here"), "absent", "x")
		expect(tr.docChanged).toBe(false)
	})
})
