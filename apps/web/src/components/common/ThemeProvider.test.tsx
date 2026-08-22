/**
 * @vitest-environment node
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pluginThemePalettes } from "@hoardodile/sdk-web"
import { describe, expect, it } from "vitest"
import en from "@/i18n/en.json"
import zh from "@/i18n/zh.json"

// Guards the remaining manual steps of adding a palette: the CSS token
// block in @hoardodile/ui and the i18n labels. Forgetting either turns
// this suite red instead of silently shipping a broken palette option.

const themeCss = readFileSync(
	// Vitest runs with cwd at the package root (apps/web).
	resolve(process.cwd(), "../../packages/ui/src/styles/theme.css"),
	"utf-8",
)

describe("theme palette registry", () => {
	it("every palette has a stylesheet block in @hoardodile/ui/theme.css", () => {
		for (const id of pluginThemePalettes) {
			expect(themeCss).toContain(`.theme-${id}`)
		}
	})

	it("every palette has an i18n label in both locales", () => {
		for (const id of pluginThemePalettes) {
			expect(en.theme.palette).toHaveProperty(id)
			expect(zh.theme.palette).toHaveProperty(id)
		}
	})
})
