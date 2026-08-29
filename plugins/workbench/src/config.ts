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
 * - `mode: "bare"` — the workbench's own presentation default: render the
 *   plugin edge-to-edge (no padding / rounded corners / card chrome).
 *   `"desktop"` is the app preview shape (a padded, rounded, shadowed
 *   card); `"mobile"` is a phone-width card.
 *
 * Persisted to localStorage under {@link WORKBENCH_STORAGE_KEY} — a
 * workbench-only key, never the app's pref keys.
 */

export type WorkbenchThemeMode = "system" | "light" | "dark"
export type WorkbenchResolvedTheme = "light" | "dark"

/** How the plugin iframe is presented in the stage. */
export type WorkbenchPresentationMode = "bare" | "desktop" | "mobile"

/** The presentation mode id set, in display order (config + stage options). */
export const WORKBENCH_PRESENTATION_MODES: readonly WorkbenchPresentationMode[] =
	["bare", "desktop", "mobile"]

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
	/** Plugin iframe presentation: `bare` (edge-to-edge), `desktop`, `mobile`. */
	readonly mode: WorkbenchPresentationMode
}

export const WORKBENCH_STORAGE_KEY = "hoardodile.workbench.config"

export const WORKBENCH_DEFAULTS: WorkbenchConfig = {
	themeMode: "system",
	palette: "mono",
	iconStyle: "duotone",
	language: "system",
	fontFamily: "",
	mode: "bare",
}

/**
 * The supported language set and system-locale resolver come from the
 * published `@hoardodile/i18n` package — the same source the app and the
 * desktop shell use (no more mirrored copies).
 */
export const WORKBENCH_LANGUAGES = SUPPORTED_LANGUAGES
export type WorkbenchLanguage = SupportedLanguage
export const resolveWorkbenchLanguage = resolveSystemLanguage

/**
 * Palette / icon-style / language display names come straight from the
 * shared catalogs (`theme.palette.*`, `icons.style.*`, `language.*`) —
 * no mirrored label constants; components read them via `useTranslation`.
 */

/** Resolve the theme mode exactly like the app's `ThemeProvider`. */
export function resolveWorkbenchTheme(
	mode: WorkbenchThemeMode,
	prefersDark: boolean,
): WorkbenchResolvedTheme {
	return mode === "system" ? (prefersDark ? "dark" : "light") : mode
}

/** True when `value` is one of {@link WORKBENCH_PRESENTATION_MODES}. */
export function isPresentationMode(
	value: unknown,
): value is WorkbenchPresentationMode {
	return (
		typeof value === "string" &&
		(WORKBENCH_PRESENTATION_MODES as readonly string[]).includes(value)
	)
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
	const mode = isPresentationMode(candidate.mode)
		? candidate.mode
		: WORKBENCH_DEFAULTS.mode
	return { themeMode, palette, iconStyle, language, fontFamily, mode }
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
