import { MOBILE_INITIAL_SCALE } from "@hoardodile/ui/viewport"
import { describe, expect, it } from "vitest"
import { wrapPluginHtml } from "../scripts/mounts.mjs"

/**
 * Guards the fidelity promise of the `/plugin` mount: the page shell the
 * workbench serves is the shell the host server serves, including the
 * single viewport-scale constant from `@hoardodile/ui/viewport` —
 * the workbench can never drift from the app's mobile preview scale.
 */

const BRIDGE_MARK = "context-ready"

describe("wrapPluginHtml", () => {
	it("injects the app's mobile initial scale verbatim", () => {
		const html = wrapPluginHtml('<div id="root"></div>')
		expect(html).toContain(
			`initial-scale=${MOBILE_INITIAL_SCALE}, maximum-scale=1.0, user-scalable=0`,
		)
	})

	it("keeps the overflow reset and the postMessage bridge", () => {
		const html = wrapPluginHtml('<div id="root"></div>')
		expect(html).toContain(
			"html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}",
		)
		expect(html).toContain(`new CustomEvent("${BRIDGE_MARK}"`)
	})

	it("embeds the plugin body untouched between shell body tags", () => {
		const html = wrapPluginHtml(
			'<script>window.marker=1</script><div id="root"></div>',
		)
		expect(html).toContain(
			'<script>window.marker=1</script><div id="root"></div>',
		)
	})

	it("closes the shell after the body", () => {
		const html = wrapPluginHtml("<div></div>")
		expect(html.endsWith("</body></html>")).toBe(true)
	})
})
