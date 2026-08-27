/**
 * Splash → app handoff. The first-paint splash (index.html `#app-splash`)
 * holds the dimmed logo over an opaque, palette-matched canvas while the
 * app boots; when the boot target is ready (see `boot-splash.ts`), the
 * whole overlay simply fades out, revealing the finished page beneath — no
 * movement, no scale, so the handoff reads as one continuous surface and
 * never as a logo sliding around. Every failure path (reduced motion,
 * missed transition events) falls back to an immediate removal — the
 * splash can never hang.
 */

const FADE_MS = 180
const FADE_FALLBACK_MS = 600

export function dismissSplash(splash: HTMLElement | null): void {
	if (splash === null) return
	const overlay = splash
	if (prefersReducedMotion()) {
		overlay.remove()
		return
	}

	let done = false
	function finish(): void {
		if (done) return
		done = true
		overlay.remove()
	}

	// Land the page beneath by fading the opaque overlay (background and
	// dimmed logo together) instead of animating the logo itself.
	overlay.style.transition = `opacity ${FADE_MS}ms ease`
	overlay.style.opacity = "0"

	overlay.addEventListener("transitionend", finish, { once: true })
	// Safety net for missed transition events (e.g. a re-render racing the
	// handoff or the splash being replaced underneath).
	window.setTimeout(finish, FADE_FALLBACK_MS)
}

function prefersReducedMotion(): boolean {
	try {
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches
	} catch {
		return false
	}
}
