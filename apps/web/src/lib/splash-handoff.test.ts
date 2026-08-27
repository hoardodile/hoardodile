import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { dismissSplash } from "./splash-handoff"

function splashWith(): HTMLElement {
	document.body.innerHTML = `
		<div id="app-splash" role="progressbar">
			<img alt="" />
		</div>`
	const splash = document.getElementById("app-splash")
	if (splash === null) throw new Error("splash missing")
	return splash
}

let matchMedia: ReturnType<typeof vi.fn>

beforeEach(() => {
	vi.useFakeTimers()
	matchMedia = vi.fn(() => ({ matches: false }))
	vi.stubGlobal("matchMedia", matchMedia)
})

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
	document.body.innerHTML = ""
})

describe("dismissSplash", () => {
	it("fades the overlay out and removes it on the transition end", () => {
		const splash = splashWith()
		dismissSplash(splash)

		expect(splash.style.opacity).toBe("0")
		expect(splash.style.transition).toContain("opacity 180ms")
		expect(document.getElementById("app-splash")).not.toBeNull()

		splash.dispatchEvent(new Event("transitionend"))
		expect(document.getElementById("app-splash")).toBeNull()
	})

	it("falls back to removal when the transition never ends", () => {
		const splash = splashWith()
		dismissSplash(splash)
		expect(document.getElementById("app-splash")).not.toBeNull()
		vi.advanceTimersByTime(600)
		expect(document.getElementById("app-splash")).toBeNull()
	})

	it("removes immediately under reduced motion", () => {
		matchMedia.mockReturnValue({ matches: true })
		const splash = splashWith()
		dismissSplash(splash)
		expect(document.getElementById("app-splash")).toBeNull()
	})

	it("accepts a missing splash without throwing", () => {
		expect(() => dismissSplash(null)).not.toThrow()
	})
})
