/**
 * @vitest-environment jsdom
 */

import { BlockNoteEditor } from "@blocknote/core"
import { act, renderHook } from "@testing-library/react"
import { EditorState } from "prosemirror-state"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { blocksToDoc } from "../diffCompute.ts"
import type { DocEditorInstance } from "../editor/schema.ts"
import { docSchema } from "../editor/schema.ts"
import { useDocFind } from "./useDocFind"

type TestEditor = ReturnType<
	typeof BlockNoteEditor.create<{ schema: typeof docSchema }>
>

describe("useDocFind", () => {
	let noteEditor: TestEditor
	let editor: DocEditorInstance

	beforeAll(() => {
		noteEditor = BlockNoteEditor.create({ schema: docSchema })
		const doc = blocksToDoc(noteEditor._tiptapEditor.state.schema, [
			{ type: "paragraph", content: "alpha beta alpha" },
		])
		const state = EditorState.create({
			schema: noteEditor._tiptapEditor.state.schema,
			doc,
		})
		// The hook only needs a live document, a change subscription, the
		// history commands and a focus target — the surface
		// `DocEditorInstance` exposes. The search extension is absent on
		// purpose: highlights are its job, covered by the matcher's tests.
		editor = {
			onChange: () => () => {},
			prosemirrorView: {
				state,
				dom: document.createElement("div"),
				focus: () => {},
			},
			getExtension: () => undefined,
			undo: () => {},
			redo: () => {},
		} as unknown as DocEditorInstance
	})

	afterAll(() => {
		noteEditor._tiptapEditor.destroy()
	})

	function mount(docId = "doc-1") {
		return renderHook(
			(props: { docId: string }) =>
				useDocFind({ editor, docId: props.docId, readOnly: false }),
			{ initialProps: { docId } },
		)
	}

	it("starts closed with the replace row collapsed", () => {
		const { result } = mount()
		expect(result.current.open).toBe(false)
		expect(result.current.bar.replaceOpen).toBe(false)
	})

	it("expands the replace row on demand and through openReplace", () => {
		const { result } = mount()

		expect(result.current.bar.replaceOpen).toBe(false)
		act(() => result.current.bar.onToggleReplace())
		expect(result.current.bar.replaceOpen).toBe(true)
		act(() => result.current.bar.onToggleReplace())
		expect(result.current.bar.replaceOpen).toBe(false)

		// Ctrl+H opens the widget *and* expands the row.
		act(() => result.current.openReplace())
		expect(result.current.open).toBe(true)
		expect(result.current.bar.replaceOpen).toBe(true)
	})

	it("keeps the replace row state when plain find opens the widget", () => {
		const { result } = mount()

		act(() => result.current.bar.onToggleReplace())
		act(() => result.current.openFind())
		expect(result.current.open).toBe(true)
		expect(result.current.bar.replaceOpen).toBe(true)

		act(() => result.current.closeFind())
		expect(result.current.open).toBe(false)
		// Remembered for the session, like the editor's own find widget.
		expect(result.current.bar.replaceOpen).toBe(true)
	})

	it("counts the matches of the live document while open", () => {
		const { result } = mount()

		act(() => result.current.openFind())
		expect(result.current.bar.total).toBe(0)

		act(() => result.current.bar.onQueryChange("alpha"))
		expect(result.current.bar.total).toBe(2)
		expect(result.current.bar.currentIndex).toBe(1)

		act(() => result.current.bar.onToggleCase())
		expect(result.current.bar.caseSensitive).toBe(true)
	})

	it("passes read-only through to the bar", () => {
		const { result } = renderHook(() =>
			useDocFind({ editor, docId: "doc-1", readOnly: true }),
		)
		expect(result.current.bar.readOnly).toBe(true)
	})

	it("starts a new search when the document changes", () => {
		const { result, rerender } = mount()

		act(() => result.current.openFind())
		act(() => result.current.bar.onQueryChange("alpha"))
		act(() => result.current.bar.onToggleReplace())
		expect(result.current.open).toBe(true)

		rerender({ docId: "doc-2" })
		expect(result.current.open).toBe(false)
		expect(result.current.bar.query).toBe("")
		expect(result.current.bar.replaceOpen).toBe(false)
	})

	it("navigates the matches in a ring", () => {
		const { result } = mount()

		act(() => result.current.openFind())
		act(() => result.current.bar.onQueryChange("alpha"))
		expect(result.current.bar.currentIndex).toBe(1)

		act(() => result.current.bar.onNext())
		expect(result.current.bar.currentIndex).toBe(2)
		act(() => result.current.bar.onNext())
		expect(result.current.bar.currentIndex).toBe(1)
		act(() => result.current.bar.onPrevious())
		expect(result.current.bar.currentIndex).toBe(2)
	})
})
