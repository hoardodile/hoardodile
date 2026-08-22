import { renderHook, waitFor } from "@testing-library/react"
import type { RefObject } from "react"
import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DocEditorHandle } from "@/features/doc/editor/DocEditor"
import { useDocScrollRestore } from "./useDocScrollRestore"

const ANCHOR_FALLBACK_Y = 96

function makeBlock(id: string, top: number): HTMLElement {
	const el = document.createElement("div")
	el.dataset.id = id
	vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
		top,
		bottom: top + 40,
		height: 40,
		left: 0,
		right: 800,
		width: 800,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	})
	return el
}

function setupFixture() {
	const container = document.createElement("div")
	container.setAttribute("data-app-scroll", "")
	document.body.appendChild(container)
	// jsdom 30 does not implement element scroll methods.
	Object.defineProperties(container, {
		scrollTo: { writable: true, configurable: true, value: vi.fn() },
		scrollBy: { writable: true, configurable: true, value: vi.fn() },
	})
	const root = document.createElement("div")
	const blocks = [
		makeBlock("b1", 60),
		makeBlock("b2", 300),
		makeBlock("b3", 700),
	]
	root.append(...blocks)
	const handleRef: RefObject<DocEditorHandle | null> = createRef()
	handleRef.current = {
		editor: { domElement: root },
	} as DocEditorHandle
	return {
		container,
		root,
		blocks,
		handleRef,
		scrollToSpy: container.scrollTo as unknown as ReturnType<typeof vi.fn>,
		scrollBySpy: container.scrollBy as unknown as ReturnType<typeof vi.fn>,
	}
}

afterEach(() => {
	vi.restoreAllMocks()
	document.body.innerHTML = ""
	localStorage.clear()
})

describe("useDocScrollRestore", () => {
	it("restores to the saved block when the docId matches", async () => {
		const fixture = setupFixture()
		localStorage.setItem(
			"document.lastScroll",
			JSON.stringify({
				docId: "doc-1",
				blockId: "b2",
				offset: 0,
				updatedAtMs: 1,
			}),
		)
		renderHook(() =>
			useDocScrollRestore({
				docId: "doc-1",
				ready: true,
				editorHandleRef: fixture.handleRef,
			}),
		)
		// Restore keeps re-aligning for a few frames; b2's top (300) should
		// be moved to the anchor fallback (96) + offset (0).
		await waitFor(() => expect(fixture.scrollBySpy).toHaveBeenCalled())
		const [firstCall] = fixture.scrollBySpy.mock.calls
		const first = firstCall?.[0] as { top: number } | undefined
		expect(first?.top).toBeCloseTo(300 - ANCHOR_FALLBACK_Y)
		expect(fixture.scrollToSpy).not.toHaveBeenCalled()
	})

	it("scrolls to the top when the saved position belongs to another document", () => {
		const fixture = setupFixture()
		localStorage.setItem(
			"document.lastScroll",
			JSON.stringify({
				docId: "doc-other",
				blockId: "b2",
				offset: 0,
				updatedAtMs: 1,
			}),
		)
		renderHook(() =>
			useDocScrollRestore({
				docId: "doc-1",
				ready: true,
				editorHandleRef: fixture.handleRef,
			}),
		)
		expect(fixture.scrollToSpy).toHaveBeenCalledWith({
			top: 0,
			behavior: "instant",
		})
		expect(fixture.scrollBySpy).not.toHaveBeenCalled()
	})

	it("starts at the top when nothing is stored", () => {
		const fixture = setupFixture()
		renderHook(() =>
			useDocScrollRestore({
				docId: "doc-1",
				ready: true,
				editorHandleRef: fixture.handleRef,
			}),
		)
		expect(fixture.scrollToSpy).toHaveBeenCalledWith({
			top: 0,
			behavior: "instant",
		})
	})

	it("captures the reading position on scroll", async () => {
		const fixture = setupFixture()
		renderHook(() =>
			useDocScrollRestore({
				docId: "doc-1",
				ready: true,
				editorHandleRef: fixture.handleRef,
			}),
		)
		// No stored position: top-scroll settles synchronously, so a scroll
		// right after mount captures immediately (first tick bypasses the
		// throttle window).
		fixture.container.dispatchEvent(new Event("scroll"))
		await waitFor(() => {
			const stored = localStorage.getItem("document.lastScroll")
			expect(stored).not.toBeNull()
			const parsed = JSON.parse(stored ?? "") as {
				docId: string
				blockId: string
				offset: number
			}
			expect(parsed.docId).toBe("doc-1")
			// The block sitting on the anchor fallback (96): b1 at 60.
			expect(parsed.blockId).toBe("b1")
			expect(parsed.offset).toBe(60 - ANCHOR_FALLBACK_Y)
		})
	})

	it("does not capture while a restore is still settling", async () => {
		const fixture = setupFixture()
		localStorage.setItem(
			"document.lastScroll",
			JSON.stringify({
				docId: "doc-1",
				blockId: "b2",
				offset: 0,
				updatedAtMs: 1,
			}),
		)
		renderHook(() =>
			useDocScrollRestore({
				docId: "doc-1",
				ready: true,
				editorHandleRef: fixture.handleRef,
			}),
		)
		// Immediately after mount the restore is re-aligning: a scroll must
		// not overwrite the slot with an interim position.
		fixture.container.dispatchEvent(new Event("scroll"))
		expect(
			JSON.parse(localStorage.getItem("document.lastScroll") ?? ""),
		).toEqual({
			docId: "doc-1",
			blockId: "b2",
			offset: 0,
			updatedAtMs: 1,
		})
	})

	it("does nothing before the editor is ready", () => {
		const fixture = setupFixture()
		renderHook(() =>
			useDocScrollRestore({
				docId: "doc-1",
				ready: false,
				editorHandleRef: fixture.handleRef,
			}),
		)
		expect(fixture.scrollToSpy).not.toHaveBeenCalled()
		expect(fixture.scrollBySpy).not.toHaveBeenCalled()
	})
})
