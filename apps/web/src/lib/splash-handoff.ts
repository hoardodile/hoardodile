/**
 * Splash → app handoff. The first-paint splash (index.html `#app-splash`)
 * holds the dimmed logo over an opaque, palette-matched canvas while the
 * app boots; when the boot target is ready (see `boot-splash.ts`), the
 * overlay is removed in a single hard cut, revealing the finished page
 * beneath — no fade, no movement, no scale. The removal is synchronous, so
 * the splash can never hang on the way out.
 */

export function dismissSplash(splash: HTMLElement | null): void {
	if (splash === null) return
	splash.remove()
}
