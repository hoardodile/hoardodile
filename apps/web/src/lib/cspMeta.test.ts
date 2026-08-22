/**
 * @vitest-environment node
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
	buildPolicy,
	extractInlineScripts,
	servePolicy,
	sha256Base64,
} from "../../../../scripts/lib/csp-meta.ts"

const webIndexHtml = readFileSync(
	new URL("../../index.html", import.meta.url),
	"utf8",
)
const wizardIndexHtml = readFileSync(
	new URL("../../../desktop/src/wizard/index.html", import.meta.url),
	"utf8",
)

function scriptSrcDirective(policy: string): string {
	const directive = policy
		.split("; ")
		.find((part) => part.startsWith("script-src "))
	if (directive === undefined) {
		throw new Error(`no script-src directive in: ${policy}`)
	}
	return directive
}

describe("csp-meta policies", () => {
	it("extracts exactly the theme inline script from the SPA index.html", () => {
		const scripts = extractInlineScripts(webIndexHtml)
		expect(scripts).toHaveLength(1)
		expect(scripts[0]).toContain('localStorage.getItem("theme")')
	})

	it("extracts the wizard's inline theme script", () => {
		expect(extractInlineScripts(wizardIndexHtml)).toHaveLength(1)
	})

	it("build policy hashes every inline script and forbids inline/eval", () => {
		const scripts = extractInlineScripts(webIndexHtml)
		const scriptSrc = scriptSrcDirective(buildPolicy(scripts))
		for (const script of scripts) {
			expect(scriptSrc).toContain(`'sha256-${sha256Base64(script)}'`)
		}
		expect(scriptSrc).not.toContain("unsafe-inline")
		expect(scriptSrc).not.toContain("unsafe-eval")
	})

	it("build policy fails loud when the document has no inline scripts", () => {
		expect(() => buildPolicy([])).toThrow()
	})

	it("serve policy allows inline scripts but never eval", () => {
		const scriptSrc = scriptSrcDirective(servePolicy())
		expect(scriptSrc).toContain("'unsafe-inline'")
		expect(scriptSrc).not.toContain("unsafe-eval")
	})

	it("keeps the authorized update check reachable and only in connect-src", () => {
		for (const policy of [
			servePolicy(),
			buildPolicy(extractInlineScripts(webIndexHtml)),
		]) {
			expect(policy).toContain("https://api.github.com")
		}
		// Production must not carry dev-only websocket sources.
		expect(buildPolicy(extractInlineScripts(webIndexHtml))).not.toContain("ws:")
		expect(servePolicy()).toContain("ws:")
	})
})
