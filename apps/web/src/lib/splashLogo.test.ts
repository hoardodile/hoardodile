/**
 * @vitest-environment node
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
	installSplashLogo,
	logoDataUrl,
	SPLASH_LOGO_TOKEN,
} from "../../../../scripts/lib/splash-logo.ts"

const webIndexHtml = readFileSync(
	new URL("../../index.html", import.meta.url),
	"utf8",
)
const wizardIndexHtml = readFileSync(
	new URL("../../../desktop/src/wizard/index.html", import.meta.url),
	"utf8",
)

describe("splash logo inlining", () => {
	it("renders a splash with exactly one logo token in both documents", () => {
		for (const html of [webIndexHtml, wizardIndexHtml]) {
			expect(html).toContain('id="app-splash"')
			expect(html).toContain('role="progressbar"')
			expect(html.split(SPLASH_LOGO_TOKEN).length - 1).toBe(1)
		}
	})

	it("replaces the token with a base64 data URL", () => {
		const dataUrl = logoDataUrl(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
		const result = installSplashLogo(
			`<img src="${SPLASH_LOGO_TOKEN}" alt="" />`,
			dataUrl,
		)
		expect(result).toBe(`<img src="data:image/png;base64,iVBORw==" alt="" />`)
	})

	it("fails loud when the marker drifted out of the document", () => {
		expect(() =>
			installSplashLogo(`<img src="" alt="" />`, "data:image/png;base64,AA=="),
		).toThrow(/splash-logo/)
	})
})
