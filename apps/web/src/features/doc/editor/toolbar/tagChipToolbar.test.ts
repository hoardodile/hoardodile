import { BlockNoteEditor } from "@blocknote/core"
import { NodeSelection, TextSelection } from "prosemirror-state"
import { act } from "react"
import { describe, expect, it } from "vitest"
import { docSchema } from "../schema.ts"
import { handleChipMouseDown } from "../TagChipInline.tsx"
import { applyTagChip, getActiveTagChipColor } from "./tagChipToolbar.ts"

describe("tagChipToolbar", () => {
	function createEditor(initialContent?: unknown[]) {
		return BlockNoteEditor.create({
			schema: docSchema,
			initialContent: (initialContent as never) ?? undefined,
		})
	}

	function selectText(editor: ReturnType<typeof createEditor>) {
		const { state } = editor._tiptapEditor
		let from = -1
		let to = -1
		state.doc.descendants((node, pos) => {
			if (node.isText && from === -1) {
				from = pos
				to = pos + node.nodeSize
			}
		})
		if (from === -1) return
		const tr = state.tr.setSelection(TextSelection.create(state.doc, from, to))
		editor._tiptapEditor.view.dispatch(tr)
	}

	function selectChip(editor: ReturnType<typeof createEditor>) {
		const { state } = editor._tiptapEditor
		let from = -1
		let to = -1
		state.doc.descendants((node, pos) => {
			if (node.type.name === "tagChip" && from === -1) {
				from = pos
				to = pos + node.nodeSize
			}
		})
		if (from === -1) return
		const tr = state.tr.setSelection(TextSelection.create(state.doc, from, to))
		editor._tiptapEditor.view.dispatch(tr)
	}

	it("wraps selected text in a tagChip inline node", () => {
		const editor = createEditor([
			{
				type: "paragraph",
				content: [{ type: "text", text: "hello world", styles: {} }],
			},
		])

		selectText(editor)
		applyTagChip(editor, "#E74C3C")

		const block = editor.document[0]
		expect(block?.type).toBe("paragraph")
		expect(block?.content).toEqual([
			{
				type: "tagChip",
				props: { color: "#E74C3C", text: "hello world" },
			},
		])
	})

	it("updates the color of an existing tagChip", () => {
		const editor = createEditor([
			{
				type: "paragraph",
				content: [
					{
						type: "tagChip",
						props: { color: "#E74C3C", text: "tagged" },
					},
				],
			},
		])

		selectChip(editor)

		expect(getActiveTagChipColor(editor)).toBe("#E74C3C")

		applyTagChip(editor, "#27AE60")

		const block = editor.document[0]
		const chip = (block?.content as unknown[] | undefined)?.[0]
		expect(chip).toMatchObject({
			type: "tagChip",
			props: { color: "#27AE60", text: "tagged" },
		})
	})

	it("removes a tagChip and restores its text when color is cleared", () => {
		const editor = createEditor([
			{
				type: "paragraph",
				content: [
					{
						type: "tagChip",
						props: { color: "#E74C3C", text: "tagged" },
					},
				],
			},
		])

		selectChip(editor)
		applyTagChip(editor, "")

		const block = editor.document[0]
		expect(block?.content).toEqual([
			{ type: "text", text: "tagged", styles: {} },
		])
	})

	it("selects the chip node on mousedown", () => {
		const editor = createEditor([
			{
				type: "paragraph",
				content: [
					{ type: "text", text: "before ", styles: {} },
					{
						type: "tagChip",
						props: { color: "#E74C3C", text: "tagged" },
					},
					{ type: "text", text: " after", styles: {} },
				],
			},
		])

		const container = document.createElement("div")
		document.body.appendChild(container)
		act(() => {
			editor.mount(container)
		})

		const chipEl = editor._tiptapEditor.view.dom.querySelector(
			'[data-inline-content-type="tagChip"]',
		) as HTMLElement | null
		expect(chipEl).not.toBeNull()

		let prevented = false
		handleChipMouseDown(
			{
				currentTarget: chipEl!,
				preventDefault: () => {
					prevented = true
				},
			},
			editor,
		)

		expect(prevented).toBe(true)
		const { state } = editor._tiptapEditor
		expect(state.selection instanceof NodeSelection).toBe(true)
		const node = state.doc.nodeAt(state.selection.from)
		expect(node?.type.name).toBe("tagChip")
		expect(node?.attrs.text).toBe("tagged")

		container.remove()
	})
})
