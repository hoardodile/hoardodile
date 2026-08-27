import { afterEach, describe, expect, it } from "vitest"
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

afterEach(() => {
	document.body.innerHTML = ""
})

describe("dismissSplash", () => {
	it("removes the overlay immediately — a hard cut, no animation", () => {
		const splash = splashWith()
		dismissSplash(splash)

		expect(document.getElementById("app-splash")).toBeNull()
		expect(splash.isConnected).toBe(false)
	})

	it("accepts a missing splash without throwing", () => {
		expect(() => dismissSplash(null)).not.toThrow()
	})
})
