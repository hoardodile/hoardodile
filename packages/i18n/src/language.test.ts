/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest"
import { UI_CATALOGS, uiCatalogFor } from "./catalogs/ui.ts"
import { CATALOGS, catalogFor } from "./catalogs.ts"
import {
	isSupportedLanguage,
	resolveSystemLanguage,
	SUPPORTED_LANGUAGES,
} from "./core.ts"

describe("resolveSystemLanguage", () => {
	it("maps base codes onto the supported set", () => {
		expect(resolveSystemLanguage("ja-JP")).toBe("ja")
		expect(resolveSystemLanguage("de-DE")).toBe("de")
		expect(resolveSystemLanguage("es-MX")).toBe("es")
		expect(resolveSystemLanguage("es")).toBe("es")
		// Any Chinese base maps to the `zh` catalog, preserving history.
		expect(resolveSystemLanguage("zh-CN")).toBe("zh")
		expect(resolveSystemLanguage("zh-TW")).toBe("zh")
		expect(resolveSystemLanguage("ZH-hant")).toBe("zh")
		expect(resolveSystemLanguage("en-US")).toBe("en")
	})

	it("falls back to English for unknown or missing values", () => {
		expect(resolveSystemLanguage("fr")).toBe("en")
		expect(resolveSystemLanguage("")).toBe("en")
		expect(resolveSystemLanguage(undefined)).toBe("en")
	})
})

describe("catalogFor", () => {
	it("returns the matching catalog for every supported language", () => {
		for (const code of SUPPORTED_LANGUAGES) {
			expect(catalogFor(code), `catalogFor(${code})`).toBe(
				CATALOGS[code as (typeof SUPPORTED_LANGUAGES)[number]],
			)
		}
	})

	it("falls back to English when no language is pushed yet", () => {
		expect(catalogFor(undefined)).toBe(CATALOGS.en)
	})
})

describe("uiCatalogFor", () => {
	it("returns the matching ui catalog for every supported language", () => {
		for (const code of SUPPORTED_LANGUAGES) {
			expect(uiCatalogFor(code), `uiCatalogFor(${code})`).toBe(
				UI_CATALOGS[code as (typeof SUPPORTED_LANGUAGES)[number]],
			)
		}
	})

	it("falls back to English when no language is pushed yet", () => {
		expect(uiCatalogFor(undefined)).toBe(UI_CATALOGS.en)
	})
})

describe("isSupportedLanguage", () => {
	it("accepts exactly the supported base codes", () => {
		for (const code of SUPPORTED_LANGUAGES) {
			expect(isSupportedLanguage(code)).toBe(true)
		}
		expect(isSupportedLanguage("de-DE")).toBe(false)
		expect(isSupportedLanguage("fr")).toBe(false)
		expect(isSupportedLanguage("")).toBe(false)
	})
})
