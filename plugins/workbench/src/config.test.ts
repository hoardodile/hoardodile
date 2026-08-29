import { pluginThemePalettes } from "@hoardodile/sdk-web"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	loadWorkbenchConfig,
	resolveWorkbenchLanguage,
	resolveWorkbenchTheme,
	saveWorkbenchConfig,
	WORKBENCH_DEFAULTS,
	WORKBENCH_PRESENTATION_MODES,
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
		// App preview: the plugin iframe fills the workbench surface.
		expect(WORKBENCH_DEFAULTS.mode).toBe("bare")
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

describe("presentation mode", () => {
	it("is bare by default", () => {
		expect(WORKBENCH_DEFAULTS.mode).toBe("bare")
		expect(WORKBENCH_PRESENTATION_MODES).toEqual(["bare", "desktop", "mobile"])
	})

	it("round-trips the known modes and rejects unknown ones", () => {
		localStorage.setItem(
			WORKBENCH_STORAGE_KEY,
			JSON.stringify({ mode: "desktop" }),
		)
		expect(loadWorkbenchConfig().mode).toBe("desktop")
		localStorage.setItem(
			WORKBENCH_STORAGE_KEY,
			JSON.stringify({ mode: "mobile" }),
		)
		expect(loadWorkbenchConfig().mode).toBe("mobile")
		localStorage.setItem(
			WORKBENCH_STORAGE_KEY,
			JSON.stringify({ mode: "hypervision" }),
		)
		expect(loadWorkbenchConfig().mode).toBe("bare")
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
			mode: "mobile",
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
				mode: "hypervision",
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
		expect(loaded.mode).toBe("bare")
	})

	it("treats a legacy viewport config as invalid and falls back to bare", () => {
		localStorage.setItem(
			WORKBENCH_STORAGE_KEY,
			JSON.stringify({ viewport: { width: 100, height: 99999 } }),
		)
		expect(loadWorkbenchConfig().mode).toBe("bare")
	})
})
