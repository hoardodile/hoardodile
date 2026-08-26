import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { dismissSplash } from "./splash-handoff"

function setRect(
	element: HTMLElement,
	rect: { readonly left: number; readonly top: number; readonly width: number },
): void {
	Object.defineProperty(element, "getBoundingClientRect", {
		configurable: true,
		value: () => ({
			...rect,
			right: rect.left + rect.width,
			bottom: 0,
			x: 0,
			y: 0,
			height: rect.width,
		}),
	})
}

function splashWith(rect: {
	left: number
	top: number
	width: number
}): HTMLElement {
	document.body.innerHTML = `
		<div id="app-splash" role="progressbar">
			<img alt="" />
		</div>`
	const splash = document.getElementById("app-splash")
	if (splash === null) throw new Error("splash missing")
	setRect(splash.querySelector("img") as HTMLElement, rect)
	return splash
}

function loginLogo(rect: {
	left: number
	top: number
	width: number
}): HTMLElement {
	const logo = document.createElement("img")
	logo.setAttribute("data-login-logo", "")
	logo.style.position = "absolute"
	document.body.appendChild(logo)
	setRect(logo, rect)
	return logo
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
	it("removes immediately when the login logo is not the destination", () => {
		const splash = splashWith({ left: 100, top: 100, width: 80 })
		dismissSplash(splash)
		expect(document.getElementById("app-splash")).toBeNull()
	})

	it("morphs onto the login logo and removes on the transition end", () => {
		const splash = splashWith({ left: 100, top: 100, width: 80 })
		loginLogo({ left: 120, top: 60, width: 56 })
		dismissSplash(splash)

		const img = splash.querySelector("img") as HTMLElement
		expect(img.style.opacity).toBe("1")
		expect(img.style.transform).toContain("translate(20px, -40px)")
		expect(img.style.transform).toContain("scale(0.7)")
		expect(splash.style.backgroundColor).toBe("transparent")
		expect(document.getElementById("app-splash")).not.toBeNull()

		img.dispatchEvent(new Event("transitionend"))
		expect(document.getElementById("app-splash")).toBeNull()
	})

	it("falls back to removal when the transition never ends", () => {
		const splash = splashWith({ left: 100, top: 100, width: 80 })
		loginLogo({ left: 120, top: 60, width: 56 })
		dismissSplash(splash)
		expect(document.getElementById("app-splash")).not.toBeNull()
		vi.advanceTimersByTime(600)
		expect(document.getElementById("app-splash")).toBeNull()
	})

	it("removes immediately under reduced motion", () => {
		matchMedia.mockReturnValue({ matches: true })
		const splash = splashWith({ left: 100, top: 100, width: 80 })
		loginLogo({ left: 120, top: 60, width: 56 })
		dismissSplash(splash)
		expect(document.getElementById("app-splash")).toBeNull()
	})

	it("accepts a missing splash without throwing", () => {
		expect(() => dismissSplash(null)).not.toThrow()
	})
})
