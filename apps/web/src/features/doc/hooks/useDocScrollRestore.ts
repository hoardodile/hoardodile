import type { RefObject } from "react"
import { useEffect, useRef } from "react"
import type { DocEditorHandle } from "@/features/doc/editor/DocEditor"
import {
	getAppScrollContainer,
	readingAnchorY,
	scrollBlockToReadingAnchor,
} from "@/features/doc/lib/docReadingAnchor"
import {
	readDocScrollPosition,
	writeDocScrollPosition,
} from "@/features/doc/lib/docScrollPosition"

const SAVE_INTERVAL_MS = 250

/** Frames to keep re-aligning the restored position (~80ms total). */
const RESTORE_FRAMES = 5

/**
 * The topmost block the user is actually reading: the last block (in
 * document order) whose top sits on or above the reading anchor line.
 * Anchored (rather than raw `scrollTop`) so the position survives zoom,
 * reading-width, and reading-view changes between sessions.
 */
function blockOnReadingAnchor(
	root: Element,
): { readonly id: string; readonly top: number } | null {
	const anchorY = readingAnchorY()
	let best: { readonly id: string; readonly top: number } | null = null
	for (const el of root.querySelectorAll<HTMLElement>("[data-id]")) {
		const id = el.dataset.id
		if (id === undefined || id.length === 0) continue
		const top = el.getBoundingClientRect().top
		if (top <= anchorY) {
			best = { id, top }
		} else {
			break
		}
	}
	return best
}

function capturePosition(docId: string, root: Element): void {
	const block = blockOnReadingAnchor(root)
	if (block === null) return
	writeDocScrollPosition({
		docId,
		blockId: block.id,
		offset: Math.round(block.top - readingAnchorY()),
		updatedAtMs: Date.now(),
	})
}

export type DocScrollRestoreOptions = {
	readonly docId: string
	/** True once the editor is actually mounted (deferred + offline cache). */
	readonly ready: boolean
	readonly editorHandleRef: RefObject<DocEditorHandle | null>
}

/**
 * Remember the reading position of the most recently opened document and
 * restore it whenever the same document opens again (refresh, back
 * navigation, re-entry from a list).
 *
 * A single localStorage slot holds `{ docId, blockId, offset }`: a
 * matching `docId` restores to the saved anchor, anything else (another
 * document, or none) starts at the top — the previous document's position
 * is discarded by the next capture. Captures run while scrolling
 * (throttled) and flush on unmount / `pagehide`; they pause while a
 * restore is still settling so interim positions are never written back.
 */
export function useDocScrollRestore(options: DocScrollRestoreOptions) {
	const { docId, ready, editorHandleRef } = options
	const restoringRef = useRef(false)

	useEffect(() => {
		if (!ready) return
		const editor = editorHandleRef.current?.editor
		const root = editor?.domElement
		if (root === undefined) {
			restoringRef.current = false
			return
		}
		const stored = readDocScrollPosition()
		const container = getAppScrollContainer()

		if (stored === undefined || stored.docId !== docId) {
			// No position for this document (or another document's): the
			// container may still sit where the previous page scrolled to.
			container.scrollTo({ top: 0, behavior: "instant" })
			restoringRef.current = false
			return
		}

		restoringRef.current = true
		let found = false
		let attempts = 0
		const frame = requestAnimationFrame(function tick() {
			attempts += 1
			const block = root.querySelector<HTMLElement>(
				`[data-id="${stored.blockId}"]`,
			)
			if (block !== null) {
				found = true
				scrollBlockToReadingAnchor(block, stored.offset)
			}
			if (attempts < RESTORE_FRAMES) {
				requestAnimationFrame(tick)
				return
			}
			// Settle: the saved block is gone (content changed) or the
			// layout stopped shifting — fall back to the top.
			if (!found) container.scrollTo({ top: 0, behavior: "instant" })
			restoringRef.current = false
		})
		return () => {
			cancelAnimationFrame(frame)
			restoringRef.current = false
		}
	}, [ready, docId, editorHandleRef])

	useEffect(() => {
		if (!ready) return
		const container = getAppScrollContainer()
		let lastWriteAt = 0

		function save() {
			if (restoringRef.current) return
			const editor = editorHandleRef.current?.editor
			const root = editor?.domElement
			if (root === undefined) return
			capturePosition(docId, root)
		}

		function handleScroll() {
			const now = Date.now()
			if (now - lastWriteAt < SAVE_INTERVAL_MS) return
			lastWriteAt = now
			save()
		}

		container.addEventListener("scroll", handleScroll, { passive: true })
		window.addEventListener("pagehide", save)
		return () => {
			// Flush the final position before the editor unmounts.
			save()
			container.removeEventListener("scroll", handleScroll)
			window.removeEventListener("pagehide", save)
		}
	}, [ready, docId, editorHandleRef])
}
