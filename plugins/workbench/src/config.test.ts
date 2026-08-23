import { pluginThemePalettes } from "@hoardodile/sdk-web"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	describeViewport,
	loadWorkbenchConfig,
	resolveWorkbenchLanguage,
	resolveWorkbenchTheme,
	saveWorkbenchConfig,
	viewportPresetId,
	WORKBENCH_DEFAULTS,
	WORKBENCH_STORAGE_KEY,
	type WorkbenchConfig,
} from "./config.ts"

/**
 * Guards the two hard promises of the config module: the defaults are
 * the main app's hardcoded defaults, and corrupt persisted state always
 * falls back to them.
 */

class MemoryStorage implements Storage {
	private readonly map = new Map<string, string>()

	get length(): number {
		return this.map.size
	}

	clear(): void {
		this.map.clear()
	}

	getItem(key: string): string | null {
		return this.map.get(key) ?? null
	}

	key(index: number): string | null {
		return [...this.map.keys()][index] ?? null
	}

	removeItem(key: string): void {
		this.map.delete(key)
	}

	setItem(key: string, value: string): void {
		this.map.set(key, value)
	}
}

let storage: MemoryStorage

beforeEach(() => {
	storage = new MemoryStorage()
	globalThis.localStorage = storage as unknown as Storage
})

afterEach(() => {
	// @ts-expect-error — node has no localStorage; the fake is test-only.
	delete globalThis.localStorage
})

describe("WORKBENCH_DEFAULTS", () => {
	it("mirrors the main app's hardcoded defaults", () => {
		// ThemeProvider defaultTheme / defaultPalette (apps/web) — the id
		// set itself comes from the SDK's single source of truth.
		expect(WORKBENCH_DEFAULTS.themeMode).toBe("system")
		expect(WORKBENCH_DEFAULTS.palette).toBe(pluginThemePalettes[0]) // "mono"
		expect(WORKBENCH_DEFAULTS.palette).toBe("mono")
		// IconStyleProvider defaultStyle.
		expect(WORKBENCH_DEFAULTS.iconStyle).toBe("duotone")
		// i18n: system language with the "en" fallback, no font pref.
		expect(WORKBENCH_DEFAULTS.language).toBe("system")
		expect(WORKBENCH_DEFAULTS.fontFamily).toBe("")
		// App preview: the iframe fills the dialog surface.
		expect(WORKBENCH_DEFAULTS.viewport).toEqual({ width: null, height: null })
	})
})

describe("resolveWorkbenchTheme", () => {
	it("resolves system against prefers-color-scheme", () => {
		expect(resolveWorkbenchTheme("system", true)).toBe("dark")
		expect(resolveWorkbenchTheme("system", false)).toBe("light")
	})

	it("passes explicit modes through", () => {
		expect(resolveWorkbenchTheme("light", true)).toBe("light")
		expect(resolveWorkbenchTheme("dark", false)).toBe("dark")
	})
})

describe("resolveWorkbenchLanguage", () => {
	it("maps BCP-47 tags onto the supported set by base code", () => {
		expect(resolveWorkbenchLanguage("ja-JP")).toBe("ja")
		expect(resolveWorkbenchLanguage("de-DE")).toBe("de")
		expect(resolveWorkbenchLanguage("es-MX")).toBe("es")
		expect(resolveWorkbenchLanguage("zh-CN")).toBe("zh")
		expect(resolveWorkbenchLanguage("ZH-hant")).toBe("zh")
		expect(resolveWorkbenchLanguage("en-US")).toBe("en")
	})

	it("falls back to en like the app's i18n", () => {
		expect(resolveWorkbenchLanguage("fr")).toBe("en")
		expect(resolveWorkbenchLanguage("")).toBe("en")
		expect(resolveWorkbenchLanguage(undefined)).toBe("en")
	})
})

describe("viewport helpers", () => {
	it("describes the viewport for the readout", () => {
		expect(describeViewport({ width: null, height: null })).toBe("Fill")
		expect(describeViewport({ width: 375, height: 667 })).toBe("375×667")
	})

	it("matches presets by dimensions, else custom", () => {
		expect(viewportPresetId({ width: null, height: null })).toBe("fill")
		expect(viewportPresetId({ width: 768, height: 1024 })).toBe("tablet")
		expect(viewportPresetId({ width: 900, height: 700 })).toBe("custom")
	})
})

describe("persistence", () => {
	it("round-trips a config", () => {
		const config: WorkbenchConfig = {
			themeMode: "dark",
			palette: "sage",
			iconStyle: "linear",
			language: "zh",
			fontFamily: "Georgia, serif",
			viewport: { width: 1024, height: 768 },
		}
		saveWorkbenchConfig(config)
		expect(loadWorkbenchConfig()).toEqual(config)
	})

	it("falls back to the defaults on corrupt JSON", () => {
		localStorage.setItem(WORKBENCH_STORAGE_KEY, "{not json")
		expect(loadWorkbenchConfig()).toEqual(WORKBENCH_DEFAULTS)
	})

	it("falls back per-field on unknown values", () => {
		localStorage.setItem(
			WORKBENCH_STORAGE_KEY,
			JSON.stringify({
				themeMode: "polar",
				palette: "rainbow",
				iconStyle: "neon",
				language: "fr",
				fontFamily: 42,
				viewport: { width: null, height: null },
			}),
		)
		expect(loadWorkbenchConfig()).toEqual(WORKBENCH_DEFAULTS)
	})

	it("merges a partial config onto the defaults", () => {
		localStorage.setItem(
			WORKBENCH_STORAGE_KEY,
			JSON.stringify({ palette: "azure", fontFamily: "Verdana" }),
		)
		const loaded = loadWorkbenchConfig()
		expect(loaded.palette).toBe("azure")
		expect(loaded.fontFamily).toBe("Verdana")
		expect(loaded.themeMode).toBe("system")
		expect(loaded.viewport).toEqual({ width: null, height: null })
	})

	it("clamps viewport dimensions to the sane range", () => {
		localStorage.setItem(
			WORKBENCH_STORAGE_KEY,
			JSON.stringify({ viewport: { width: 100, height: 99999 } }),
		)
		expect(loadWorkbenchConfig().viewport).toEqual({ width: 320, height: 3840 })
	})

	it("treats a half-defined viewport as invalid", () => {
		localStorage.setItem(
			WORKBENCH_STORAGE_KEY,
			JSON.stringify({ viewport: { width: null, height: 600 } }),
		)
		expect(loadWorkbenchConfig().viewport).toEqual({
			width: null,
			height: null,
		})
	})
})
