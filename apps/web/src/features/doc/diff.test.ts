/**
 * @vitest-environment node
 */

import { BlockNoteEditor } from "@blocknote/core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { blocksToDoc, computeInlineDiffDoc } from "./diffCompute.ts"
import { docSchema } from "./editor/schema.ts"

type MarkedText = {
	readonly kind: "insertion" | "deletion" | "modification" | "none"
	readonly text: string
}

describe("computeInlineDiffDoc", () => {
	let editor: ReturnType<
		typeof BlockNoteEditor.create<{ schema: typeof docSchema }>
	>

	beforeAll(() => {
		editor = BlockNoteEditor.create({ schema: docSchema })
	})

	afterAll(() => {
		editor._tiptapEditor.destroy()
	})

	it("returns undefined for identical documents", () => {
		const base = [{ type: "paragraph", content: "hello" }]
		const current = [{ type: "paragraph", content: "hello" }]
		expect(computeInlineDiffDoc(editor, base, current)).toBeUndefined()
	})

	it("marks inserted text on an empty baseline", () => {
		const diffDoc = computeInlineDiffDoc(
			editor,
			[],
			[{ type: "paragraph", content: "new line" }],
		)
		expect(diffDoc).toBeDefined()
		const marks = collectMarkedText(diffDoc!)
		expect(marks).toContainEqual({ kind: "insertion", text: "new line" })
	})

	it("marks deleted text when the current version is empty", () => {
		const diffDoc = computeInlineDiffDoc(
			editor,
			[{ type: "paragraph", content: "old line" }],
			[],
		)
		expect(diffDoc).toBeDefined()
		const marks = collectMarkedText(diffDoc!)
		expect(marks).toContainEqual({ kind: "deletion", text: "old line" })
	})

	it("marks replaced text with at least one deletion and one insertion", () => {
		const diffDoc = computeInlineDiffDoc(
			editor,
			[{ type: "paragraph", content: "alpha" }],
			[{ type: "paragraph", content: "beta" }],
		)
		expect(diffDoc).toBeDefined()
		const marks = collectMarkedText(diffDoc!)
		const deleted = joinKind(marks, "deletion")
		const inserted = joinKind(marks, "insertion")
		const unchanged = joinKind(marks, "none")
		expect(deleted + unchanged).toBe("alpha")
		expect(inserted + unchanged).toBe("beta")
	})

	it("keeps equal paragraphs unchanged", () => {
		const diffDoc = computeInlineDiffDoc(
			editor,
			[
				{ type: "paragraph", content: "keep me" },
				{ type: "paragraph", content: "remove me" },
			],
			[
				{ type: "paragraph", content: "keep me" },
				{ type: "paragraph", content: "added" },
			],
		)
		expect(diffDoc).toBeDefined()
		const fullText = diffDoc!.textBetween(0, diffDoc!.content.size, "\n")
		expect(fullText).toContain("keep me")
		const marks = collectMarkedText(diffDoc!)
		expect(marks.some((m) => m.text === "keep me" && m.kind === "none")).toBe(
			true,
		)
	})

	it("never throws on changes that cross block structure", () => {
		// A text change spanning a paragraph boundary produces a replace
		// slice that does not fit its base position; the computation must
		// degrade (skip the offending region) instead of throwing.
		const diffDoc = computeInlineDiffDoc(
			editor,
			[
				{ type: "paragraph", content: "hello world" },
				{ type: "paragraph", content: "foo bar" },
			],
			[
				{ type: "paragraph", content: "hello" },
				{ type: "paragraph", content: "world foo bar" },
			],
		)
		expect(diffDoc).toBeDefined()
	})

	it("keeps granular marks for large edits spanning block boundaries", () => {
		// prosemirror-changeset 2.4.2 added a 2500-token guard that returns
		// a whole large changed range as ONE change; combined with the
		// whole-document step below that yields an unapplyable
		// boundary-crossing step and the diff degrades to no marks. 2.4.1
		// computes the range granularly and keeps the inline marks — this
		// test guards that dependency behavior (see the deliberate-upgrade
		// checklist in apps/web/src/features/doc/README.md).
		const longA = "aaaaaaaaaaaaaaaaaa".repeat(190) // > 2500 chars
		const longB = "bbbbbbbbbbbbbbbbbb".repeat(190)
		const diffDoc = computeInlineDiffDoc(
			editor,
			[
				{ type: "paragraph", content: longA },
				{ type: "paragraph", content: "hello" },
			],
			[
				{ type: "paragraph", content: longB },
				{ type: "paragraph", content: "HELLO" },
			],
		)
		expect(diffDoc).toBeDefined()
		const marks = collectMarkedText(diffDoc!)
		expect(marks.some((m) => m.kind === "deletion")).toBe(true)
		expect(marks.some((m) => m.kind === "insertion")).toBe(true)
	})

	it("round-trips real editor block shapes through blocksToDoc without throwing", () => {
		// Real `editor.document` shapes (children arrays, code string
		// content) must convert — a throw here is what silently blanks
		// the compare view.
		editor.insertBlocks(
			[
				{
					type: "checkListItem",
					content: "done",
				},
			],
			editor.document[0]!,
			"before",
		)
		editor.insertBlocks(
			[{ type: "codeBlock", content: "const x = 1" }],
			editor.document[0]!,
			"before",
		)
		const blocks = editor.document as Parameters<typeof blocksToDoc>[1]
		const doc = blocksToDoc(editor._tiptapEditor.state.schema, blocks)
		expect(doc).toBeDefined()
		const text = doc.textBetween(0, doc.content.size, "\n")
		expect(text).toContain("const x = 1")
		expect(text).toContain("done")
	})
})

function collectMarkedText(
	doc: NonNullable<ReturnType<typeof computeInlineDiffDoc>>,
): MarkedText[] {
	const out: MarkedText[] = []
	doc.descendants((node) => {
		if (!node.isText) return true
		const markNames = node.marks.map((m) => m.type.name)
		let kind: MarkedText["kind"] = "none"
		if (markNames.includes("insertion")) kind = "insertion"
		else if (markNames.includes("deletion")) kind = "deletion"
		else if (markNames.includes("modification")) kind = "modification"
		const last = out[out.length - 1]
		if (last !== undefined && last.kind === kind) {
			out[out.length - 1] = { kind, text: last.text + (node.text || "") }
		} else {
			out.push({ kind, text: node.text || "" })
		}
		return false
	})
	return out
}

function joinKind(
	marks: readonly MarkedText[],
	kind: MarkedText["kind"],
): string {
	return marks
		.filter((m) => m.kind === kind)
		.map((m) => m.text)
		.join("")
}
