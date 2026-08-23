/**
 * Locale plumbing shared by the web SPA and the Electron shell: the
 * supported-language set and pure helpers. **This module must stay
 * free of catalog imports** — the sandboxed preload imports
 * `isSupportedLanguage` from here, and the catalogs (which weigh far
 * more than this file) live in `./catalogs.ts` (`CATALOGS`,
 * `catalogFor`) plus the per-language JSON modules.
 *
 * `en.json`, `zh.json`, `ja.json`, `de.json` and `es.json` must stay
 * in lockstep: identical flat key sets, matching interpolation
 * placeholders, and complete `_one`/`_other` pairs.
 * `packages/shared/src/i18n/parity.test.ts` enforces this — run it
 * after touching any catalog. `CATALOGS: Record<SupportedLanguage,
 * typeof en>` in `catalogs.ts` additionally makes any key drift a
 * compile error in `tsc`.
 *
 * Naming conventions for catalog keys (documented, not enforced by lint so
 * existing keys stay untouched — renaming keys would churn every call site
 * against the typed `t()` from `apps/web/src/i18n`):
 *
 * - Empty-state members prefer an `empty*` suffix on the section's key:
 *   `empty`, `emptyTitle`, `emptyDescription`, `emptyPrompt`, `emptyAll`,
 *   `emptyTrash`, `emptyInline`, `emptyError`, or an entity-scoped variant
 *   (`listEmpty`, `trashEmpty`, `colEmpty`, `parentsEmpty`, `nameEmpty`,
 *   `selectedEmpty`, `charactersEmpty`, `resourcesEmpty`).
 * - `no*` is reserved for non-empty "state/find" notices: `noMatches`,
 *   `noMatch`, `noTags`, `noItems`, `noSubdirs`, `noPackages`,
 *   `noDefinitions`, `noCategories`, `noHeadings`, `noIntro`, `noSelection`,
 *   `noTypesHint`, `noDevicesTitle`, `notFound`.
 * - The `{{count}}`-bearing keys always come with `_one`/`_other` plural
 *   pairs (guarded by `parity.test.ts`); keys whose noun is passed in as a
 *   variable (e.g. `deleteEntity.usageMessage`) are allowlisted there.
 */
export const SUPPORTED_LANGUAGES = ["en", "zh", "ja", "de", "es"] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

/**
 * English fallback for the close-confirm dialog before the SPA has pushed
 * the user's language (first run / SPA never loaded). Mirrors
 * `me.desktop.closeConfirm.*` + `common.cancel` in the i18n catalogs.
 */
export const DEFAULT_CLOSE_DIALOG_STRINGS = {
	title: "Close hoardodile?",
	description: "The app keeps running in the tray unless you quit it.",
	tray: "Hide to tray",
	quit: "Quit the app",
	cancel: "Cancel",
	remember: "Remember my choice",
} as const

/** All close-dialog string keys present in the catalogs. */
export const CLOSE_DIALOG_STRING_KEYS = [
	"title",
	"description",
	"tray",
	"quit",
	"cancel",
	"remember",
] as const

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
