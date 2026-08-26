/**
 * Splash → sign-in handoff. When the boot target is the login page, the
 * splash's dimmed logo morphs onto the login logo: it translates/scales to
 * the logo's measured rectangle and reaches full opacity while the splash
 * background fades, so the page's brand mark lands seamlessly in place.
 * Every failure path (no target, unmeasurable rect, reduced motion, missed
 * events) falls back to an immediate removal — the splash can never hang.
 */

const LOGIN_LOGO_SELECTOR = "[data-login-logo]"
const MORPH_MS = 240
const MORPH_FALLBACK_MS = 600

export function dismissSplash(splash: HTMLElement | null): void {
	if (splash === null) return
	const root = splash
	if (prefersReducedMotion()) {
		root.remove()
		return
	}
	const source = root.querySelector<HTMLImageElement>("img")
	const target = document.querySelector<HTMLImageElement>(LOGIN_LOGO_SELECTOR)
	if (source === null || target === null) {
		root.remove()
		return
	}
	const from = source.getBoundingClientRect()
	const to = target.getBoundingClientRect()
	if (from.width === 0 || to.width === 0) {
		root.remove()
		return
	}

	const dx = to.left - from.left
	const dy = to.top - from.top
	const scale = to.width / from.width

	let done = false
	function finish(): void {
		if (done) return
		done = true
		root.remove()
	}

	// Land the logo on the login page's logo while the page beneath fades
	// in through the (now transparent) splash background.
	source.style.transition = `transform ${MORPH_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity ${MORPH_MS}ms ease`
	source.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`
	source.style.opacity = "1"
	root.style.transition = `background-color ${MORPH_MS}ms ease`
	root.style.backgroundColor = "transparent"

	source.addEventListener("transitionend", finish, { once: true })
	// Safety net for missed transition events (e.g. a re-render racing the
	// handoff) and for a target image that is still loading.
	window.setTimeout(finish, MORPH_FALLBACK_MS)
}

function prefersReducedMotion(): boolean {
	try {
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches
	} catch {
		return false
	}
}
