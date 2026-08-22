/** Gap below sticky chrome when computing the reading anchor line. */
export const READING_ANCHOR_GAP = 4

/** Fallback Y when sticky chrome is not in the DOM (e.g. tests). */
export const READING_ANCHOR_FALLBACK_Y = 96

/** The element carrying the app-wide scrollbar (`AppShell`'s `<main>`),
 * marked with `data-app-scroll`. Falls back to `window` for shell-less
 * contexts (e.g. tests or the login route).
 */
export function getAppScrollContainer(): HTMLElement | Window {
	const container = document.querySelector<HTMLElement>("[data-app-scroll]")
	return container ?? window
}

/** Current scroll offset of the app scroll container. */
export function scrollTopOf(container: HTMLElement | Window): number {
	return container instanceof HTMLElement
		? container.scrollTop
		: container.scrollY
}

/**
 * Y coordinate just below the lowest sticky chrome overlaying the editor.
 * Prefers the static toolbar (edit mode); falls back to the doc detail header.
 *
 * Computes the anchor from the element's *stuck* position (CSS `top` + height)
 * rather than its current viewport bottom. At `scrollY = 0` a sticky element
 * may still be in its natural (non-stuck) position, which would make the
 * anchor drift on every restore/refresh cycle.
 */
export function readingAnchorY(): number {
	const toolbar = document.querySelector(
		'[data-testid="document-static-toolbar"]',
	)
	if (toolbar !== null) {
		return stickyBottomY(toolbar)
	}
	const header = document.querySelector("[data-doc-layout] .doc-detail-header")
	if (header !== null) {
		return stickyBottomY(header)
	}
	return READING_ANCHOR_FALLBACK_Y
}

function stickyBottomY(el: Element): number {
	const style = window.getComputedStyle(el)
	const top = parseFloat(style.top)
	if (Number.isFinite(top)) {
		return top + el.getBoundingClientRect().height + READING_ANCHOR_GAP
	}
	return el.getBoundingClientRect().bottom + READING_ANCHOR_GAP
}

/** Scroll so the block top sits at `readingAnchorY() + offsetFromAnchor`. */
export function scrollBlockToReadingAnchor(
	el: Element,
	offsetFromAnchor: number,
): void {
	const targetTop = readingAnchorY() + offsetFromAnchor
	const delta = el.getBoundingClientRect().top - targetTop
	if (Math.abs(delta) < 1) return
	getAppScrollContainer().scrollBy({ top: delta, behavior: "instant" })
}

export function scrollBlockToReadingAnchorAfterLayout(
	blockId: string,
	root: Element | null | undefined,
	offsetFromAnchor: number,
): void {
	function scrollOnce() {
		const el = root?.querySelector(`[data-id="${blockId}"]`)
		if (el === null || el === undefined) return false
		scrollBlockToReadingAnchor(el, offsetFromAnchor)
		return true
	}

	requestAnimationFrame(() => {
		if (!scrollOnce()) requestAnimationFrame(scrollOnce)
	})
}
