/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import {
	CONNECTING_MESSAGE,
	DEV_SERVER_ERROR_MESSAGE,
	SERVER_ERROR_MESSAGE,
	windowErrorPageUrl,
	windowLoadingPageUrl,
} from "./error-page.ts"

function decode(url: string): string {
	const prefix = "data:text/html;charset=utf-8,"
	expect(url.startsWith(prefix)).toBe(true)
	return decodeURIComponent(url.slice(prefix.length))
}

describe("windowErrorPageUrl", () => {
	it("carries the message, the caption bar and the retry button", () => {
		const decoded = decode(windowErrorPageUrl(SERVER_ERROR_MESSAGE))
		expect(decoded).toContain("Server unreachable")
		expect(decoded).toContain(SERVER_ERROR_MESSAGE)
		expect(decoded).toContain("Retry")
		expect(decoded).toContain("bridge.retryLoad()")
		expect(decoded).toContain('id="btn-min"')
		expect(decoded).toContain('id="btn-close"')
		expect(decoded).toContain("button.disabled = true")
		expect(decoded).toContain('aria-label="Back" disabled')
		expect(decoded).toContain('aria-label="Forward" disabled')
		expect(decoded).toContain("document.activeElement")
		expect(decoded).toContain("M20.3139 11V12.6667")
		expect(decoded).toContain("pointer-events: none")
		expect(decoded).toContain("outline: none")
		expect(decoded).not.toContain("Retrying…")
	})

	it("escapes markup in the message", () => {
		const decoded = decode(windowErrorPageUrl("<script>alert(1)</script>"))
		expect(decoded).toContain("&lt;script&gt;")
		expect(decoded).not.toContain("<script>alert")
	})
})

describe("windowLoadingPageUrl", () => {
	it("shows a centered spinner and the caption bar", () => {
		const decoded = decode(windowLoadingPageUrl())
		expect(decoded).toContain(CONNECTING_MESSAGE)
		expect(decoded).toContain("spin")
		expect(decoded).toContain('id="drag"')
		expect(decoded).toContain('aria-label="Back" disabled')
		expect(decoded).toContain('aria-label="Forward" disabled')
	})
})

describe("shell constants", () => {
	it("exposes the dev message", () => {
		expect(DEV_SERVER_ERROR_MESSAGE).toContain("pnpm dev")
	})
})
