/**
 * Locale plumbing shared by the web SPA, the Electron shell and the plugin
 * SDK: the supported-language set and pure helpers. **This module must
 * stay free of catalog imports** — the sandboxed preload imports
 * `isSupportedLanguage` from here, and the catalogs (which weigh far
 * more than this file) live in `./catalogs.ts` (`CATALOGS`,
 * `catalogFor`), `./catalogs/ui.ts` (`UI_CATALOGS`, `uiCatalogFor`) plus
 * the per-language JSON modules.
 *
 * `catalogs/*.json` (the app `translation` namespace) and `ui/*.json`
 * (the shared `ui` namespace consumed by `@hoardodile/ui` and the plugin
 * SDK iframes) must stay in lockstep internally: identical flat key
 * sets, matching interpolation placeholders, and complete `_one`/`_other`
 * pairs. `src/parity.test.ts` enforces this — run it after touching any
 * catalog. `CATALOGS: Record<SupportedLanguage, typeof en>` and
 * `UI_CATALOGS: Record<SupportedLanguage, typeof uiEn>` additionally
 * make any key drift a compile error in `tsc`.
 */
export const SUPPORTED_LANGUAGES = ["en", "zh", "ja", "de", "es"] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export function isSupportedLanguage(value: string): value is SupportedLanguage {
	return (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}

/**
 * Map a BCP-47 locale string (e.g. `navigator.language`,
 * `app.getLocale()`, a stored pref) onto the supported set, taking the
 * base code: `"ja-JP"` → `"ja"`, `"de-DE"` → `"de"`, `"es-MX"` → `"es"`,
 * `"zh-CN"`/`"zh-TW"` → `"zh"` (any Chinese base maps to the `zh`
 * catalog, preserving historical behavior). Unknown or missing values
 * fall back to `"en"`.
 */
export function resolveSystemLanguage(
	raw: string | undefined,
): SupportedLanguage {
	const base = raw?.toLowerCase().split("-")[0]
	if (base !== undefined && isSupportedLanguage(base)) return base
	return "en"
}
