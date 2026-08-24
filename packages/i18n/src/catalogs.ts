/**
 * The app catalog registry: every shipped language's complete JSON
 * catalog plus the single resolution point the Electron shell (main
 * process, wizard, error pages) uses to pick translations.
 *
 * Split from `./core.ts` (pure helpers, no catalogs) so the sandboxed
 * preload and any other bundle that only needs `isSupportedLanguage` /
 * `resolveSystemLanguage` never loads the catalogs.
 *
 * `Record<SupportedLanguage, typeof en>` makes any key drift between
 * catalogs a **compile error** (the five JSON modules are structurally
 * typed); `parity.test.ts` enforces the rest (placeholders, plural
 * pairs, markup tags, ellipsis).
 */

import de from "./catalogs/de.json"
import en from "./catalogs/en.json"
import es from "./catalogs/es.json"
import ja from "./catalogs/ja.json"
import zh from "./catalogs/zh.json"
import type { SupportedLanguage } from "./core.ts"

export const CATALOGS = { en, zh, ja, de, es } as const satisfies Record<
	SupportedLanguage,
	typeof en
>

/** Resolve the app catalog for the active language; pre-SPA (undefined) → English. */
export function catalogFor(language: SupportedLanguage | undefined): typeof en {
	return language === undefined ? en : CATALOGS[language]
}
