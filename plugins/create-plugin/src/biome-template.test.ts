import { describe, expect, it } from "vitest"
import { STANDALONE_BIOME_JSON } from "./biome-template.ts"

describe("STANDALONE_BIOME_JSON", () => {
	it("is valid JSON", () => {
		expect(() => JSON.parse(STANDALONE_BIOME_JSON)).not.toThrow()
	})

	it("matches hoardodile's formatting and lint settings", () => {
		const config = JSON.parse(STANDALONE_BIOME_JSON)
		expect(config.formatter.enabled).toBe(true)
		expect(config.formatter.indentStyle).toBe("tab")
		expect(config.javascript.formatter.quoteStyle).toBe("double")
		expect(config.javascript.formatter.semicolons).toBe("asNeeded")
		expect(config.assist.actions.source.organizeImports).toBe("on")
		expect(config.css.parser.tailwindDirectives).toBe(true)
		expect(config.linter.enabled).toBe(true)
		expect(config.linter.rules.preset).toBe("recommended")
		expect(config.vcs.enabled).toBe(true)
		expect(config.vcs.useIgnoreFile).toBe(true)
	})

	it("never ships a nested-root-breaking config", () => {
		// The scaffolder writes this into a standalone plugin. It must not be
		// committed under plugins/template: biome 2.x rejects a nested root
		// config when the monorepo's own biome.json exists.
		const config = JSON.parse(STANDALONE_BIOME_JSON)
		expect(config.$schema).toBe(
			"https://biomejs.dev/schemas/2.5.10/schema.json",
		)
	})
})
