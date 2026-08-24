import {
	isSupportedLanguage,
	resolveSystemLanguage,
	SUPPORTED_LANGUAGES,
	type SupportedLanguage,
} from "@hoardodile/i18n"
import {
	type PluginIframeContext,
	type PluginThemePalette,
	pluginThemePalettes,
} from "@hoardodile/sdk-web"

/** Icon rendering styles as seen by plugins (`PluginIconStyle` is not
    re-exported by `@hoardodile/sdk-web`; derive it from the context). */
export type WorkbenchIconStyle = PluginIframeContext["iconStyle"]

/**
 * Workbench iframe configuration.
 *
 * Every default mirrors the main app's hardcoded default for the same
 * setting — the app owns no shared config module, so each default below
 * is annotated with its origin, and `config.test.ts` guards the ones
 * whose source constant can actually be imported:
 *
 * - `themeMode: "system"` — `apps/web/src/components/common/ThemeProvider.tsx`
 *   (`defaultTheme = "system"`).
 * - `palette: "mono"` — same file (`defaultPalette = "mono"`); the id set
 *   comes from `pluginThemePalettes` in `@hoardodile/sdk-web`.
 * - `iconStyle: "duotone"` — `apps/web/src/components/common/IconStyleProvider.tsx`
 *   (`defaultStyle = "duotone"`).
 * - `language: "system"` — the app resolves the stored pref, then the
 *   navigator language, then falls back to `"en"` (`apps/web/src/i18n/index.ts`);
 *   `{@link resolveWorkbenchLanguage}` is `resolveSystemLanguage` from
 *   `@hoardodile/i18n` (now published into the SDK closure, so the
 *   workbench imports it instead of mirroring it).
 * - `fontFamily: ""` — `apps/web/src/lib/fonts.ts`: with no font pref the
 *   context payload is `{ family: "", cssPaths: [] }` (`PRESET_FONTS` is
 *   empty, so `cssPaths` is always empty).
 * - viewport `fill` — the app preview dialog sizes the iframe to the
 *   placeholder geometry, i.e. "as large as the surface allows"
 *   (`apps/web/src/features/res/components/ResPreviewDialog.tsx`).
 *
 * Persisted to localStorage under {@link WORKBENCH_STORAGE_KEY} — a
 * workbench-only key, never the app's pref keys.
 */

export type WorkbenchThemeMode = "system" | "light" | "dark"
export type WorkbenchResolvedTheme = "light" | "dark"

export type WorkbenchViewport = {
	/** `null` = fill the stage (the app preview default). */
	readonly width: number | null
	readonly height: number | null
}

export type WorkbenchConfig = {
	readonly themeMode: WorkbenchThemeMode
	readonly palette: PluginThemePalette
	readonly iconStyle: WorkbenchIconStyle
	/** `"system"` or a supported language code (see {@link WORKBENCH_LANGUAGES}). */
	readonly language: string
	/**
	 * CSS `font-family` stack pushed to the plugin context. Empty = the
	 * app default: the plugin document keeps its own `--font-sans`
	 * (the system stack).
	 */
	readonly fontFamily: string
	readonly viewport: WorkbenchViewport
}

export const WORKBENCH_STORAGE_KEY = "hoardodile.workbench.config"

export const WORKBENCH_DEFAULTS: WorkbenchConfig = {
	themeMode: "system",
	palette: "mono",
	iconStyle: "duotone",
	language: "system",
	fontFamily: "",
	viewport: { width: null, height: null },
}

/**
 * The supported language set and system-locale resolver come from the
 * published `@hoardodile/i18n` package — the same source the app and the
 * desktop shell use (no more mirrored copies).
 */
export const WORKBENCH_LANGUAGES = SUPPORTED_LANGUAGES
export type WorkbenchLanguage = SupportedLanguage
export const resolveWorkbenchLanguage = resolveSystemLanguage

export const PALETTE_LABELS: Readonly<Record<PluginThemePalette, string>> = {
	// Labels match `theme.palette.*` in the app's i18n catalogs.
	mono: "Mono",
	sage: "Sage",
	parchment: "Parchment",
	azure: "Azure",
	hoardodile: "Hoardodile",
}

export const ICON_STYLE_LABELS: Readonly<Record<WorkbenchIconStyle, string>> = {
	duotone: "Duotone",
	grayscale: "Grayscale",
	linear: "Linear",
}

export const LANGUAGE_LABELS: Readonly<Record<WorkbenchLanguage, string>> = {
	en: "English",
	zh: "中文",
	ja: "日本語",
	de: "Deutsch",
	es: "Español",
}

export type ViewportPreset = {
	/** Preset id: `"fill"` or a named dimension set. */
	readonly id: "fill" | "phone" | "tablet" | "small" | "wide"
	readonly label: string
	readonly width: number | null
	readonly height: number | null
}

/** Dev-tool presets; the default (`fill`) follows the app preview. */
export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
	{ id: "fill", label: "Fill", width: null, height: null },
	{ id: "phone", label: "Phone", width: 375, height: 667 },
	{ id: "tablet", label: "Tablet", width: 768, height: 1024 },
	{ id: "small", label: "Small", width: 800, height: 600 },
	{ id: "wide", label: "Wide", width: 1200, height: 800 },
]

/** Custom-size fallback used when switching from Fill to custom (px). */
export const CUSTOM_VIEWPORT_DEFAULT = { width: 1200, height: 800 } as const

export const VIEWPORT_MIN_PX = 320
export const VIEWPORT_MAX_PX = 3840

/** Resolve the theme mode exactly like the app's `ThemeProvider`. */
export function resolveWorkbenchTheme(
	mode: WorkbenchThemeMode,
	prefersDark: boolean,
): WorkbenchResolvedTheme {
	return mode === "system" ? (prefersDark ? "dark" : "light") : mode
}

/**
 * Display line for the viewport, e.g. `"Fill"` or `"900×700"`. */
export function describeViewport(viewport: WorkbenchViewport): string {
	if (viewport.width === null || viewport.height === null) return "Fill"
	return `${viewport.width}×${viewport.height}`
}

/**
 * The preset whose dimensions match, or `"custom"`. Used to drive the
 * viewport dropdown from the (possibly user-typed) dimensions.
 */
export function viewportPresetId(viewport: WorkbenchViewport): string {
	const { width, height } = viewport
	for (const preset of VIEWPORT_PRESETS) {
		if (preset.width === width && preset.height === height) return preset.id
	}
	return "custom"
}

function clampViewportSize(value: number): number {
	return Math.min(VIEWPORT_MAX_PX, Math.max(VIEWPORT_MIN_PX, value))
}

function isViewport(value: unknown): value is WorkbenchViewport {
	if (typeof value !== "object" || value === null) return false
	const candidate = value as { width?: unknown; height?: unknown }
	const isSize = (v: unknown) =>
		v === null || (typeof v === "number" && Number.isFinite(v))
	if (!isSize(candidate.width) || !isSize(candidate.height)) return false
	return candidate.width === null
		? candidate.height === null
		: candidate.height !== null
}

function normalizeConfig(raw: unknown): WorkbenchConfig {
	const candidate =
		typeof raw === "object" && raw !== null
			? (raw as Partial<WorkbenchConfig>)
			: {}
	const themeMode =
		candidate.themeMode === "light" || candidate.themeMode === "dark"
			? candidate.themeMode
			: candidate.themeMode === "system"
				? "system"
				: WORKBENCH_DEFAULTS.themeMode
	const palette = candidate.palette
		? (pluginThemePalettes as readonly string[]).includes(candidate.palette)
			? (candidate.palette as PluginThemePalette)
			: WORKBENCH_DEFAULTS.palette
		: WORKBENCH_DEFAULTS.palette
	const iconStyle =
		candidate.iconStyle === "grayscale" || candidate.iconStyle === "linear"
			? candidate.iconStyle
			: candidate.iconStyle === "duotone"
				? "duotone"
				: WORKBENCH_DEFAULTS.iconStyle
	const language =
		typeof candidate.language === "string" &&
		(candidate.language === "system" || isSupportedLanguage(candidate.language))
			? candidate.language
			: WORKBENCH_DEFAULTS.language
	const fontFamily =
		typeof candidate.fontFamily === "string"
			? candidate.fontFamily
			: WORKBENCH_DEFAULTS.fontFamily
	let viewport = WORKBENCH_DEFAULTS.viewport
	if (isViewport(candidate.viewport) && candidate.viewport !== undefined) {
		const v = candidate.viewport
		viewport = {
			width: v.width === null ? null : clampViewportSize(Math.round(v.width)),
			height:
				v.height === null ? null : clampViewportSize(Math.round(v.height)),
		}
	}
	return { themeMode, palette, iconStyle, language, fontFamily, viewport }
}

/** Read the persisted config; corrupt or unknown values fall back to the app defaults. */
export function loadWorkbenchConfig(): WorkbenchConfig {
	try {
		const raw = localStorage.getItem(WORKBENCH_STORAGE_KEY)
		return raw === null ? WORKBENCH_DEFAULTS : normalizeConfig(JSON.parse(raw))
	} catch {
		return WORKBENCH_DEFAULTS
	}
}

export function saveWorkbenchConfig(config: WorkbenchConfig): void {
	try {
		localStorage.setItem(WORKBENCH_STORAGE_KEY, JSON.stringify(config))
	} catch {
		// Storage unavailable (private mode): the session still works.
	}
}
