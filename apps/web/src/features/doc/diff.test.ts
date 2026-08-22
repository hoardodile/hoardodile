/**
 * @vitest-environment node
 */

import { BlockNoteEditor } from "@blocknote/core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { computeInlineDiffDoc } from "./diffCompute.ts"
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
