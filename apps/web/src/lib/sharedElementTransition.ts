import { type RefObject, useLayoutEffect } from "react"
import { flushSync } from "react-dom"

/**
 * Grid → detail shared-element card transition (DESIGN.md — the
 * cover travel): the clicked grid card morphs into the detail page's
 * card while everything else crossfades. Same-document View Transitions
 * with a synchronous route swap so React flushes the new route inside
 * the transition callback; plain navigation is the fallback when the
 * API is missing or the user prefers reduced motion.
 */

/** The view-transition-names shared by the outgoing card and incoming hero. */
export const CHAR_CARD_TRANSITION = "char-card-hero"
export const RES_CARD_TRANSITION = "res-card-hero"

type ViewTransitionLike = { finished: Promise<unknown> }
type ViewTransitionDocument = Document & {
	startViewTransition: (callback: () => void) => ViewTransitionLike
}

function hasViewTransitions(
	document: Document,
): document is ViewTransitionDocument {
	return "startViewTransition" in document
}

function prefersReducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** The name whose transition is in flight — set between navigateWithSharedElement
    and the detail page's useSharedElementHero. */
let pendingName: string | null = null
let activeTransition: ViewTransitionLike | null = null

/** Navigate so the clicked card morphs into the detail page's card. */
export function navigateWithSharedElement(
	card: HTMLElement,
	name: string,
	go: () => void,
) {
	if (!hasViewTransitions(document) || prefersReducedMotion()) {
		go()
		return
	}
	card.style.viewTransitionName = name
	pendingName = name
	const transition = document.startViewTransition(() => {
		flushSync(go)
	})
	activeTransition = transition
	transition.finished.finally(() => {
		if (activeTransition === transition) activeTransition = null
		pendingName = null
		card.style.viewTransitionName = ""
	})
}

/** Detail pages: adopt the incoming card transition onto the hero card.
    No-op on direct loads — the hero carries a transition name only while
    a card transition with that name is in flight. */
export function useSharedElementHero(
	ref: RefObject<HTMLElement | null>,
	name: string,
) {
	useLayoutEffect(() => {
		const hero = ref.current
		if (pendingName !== name || hero === null) return
		pendingName = null
		hero.style.viewTransitionName = name
		activeTransition?.finished.finally(() => {
			hero.style.viewTransitionName = ""
		})
	}, [ref, name])
}
