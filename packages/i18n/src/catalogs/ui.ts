/**
 * The `ui` catalog registry: component-chrome strings shared by every
 * React consumer — `@hoardodile/ui` components (`useTranslation("ui")`),
 * the host surfaces and the plugin SDK iframes. Like the app catalogs
 * these five JSON modules must stay in lockstep; `parity.test.ts`
 * enforces it and `Record<SupportedLanguage, typeof en>` makes key drift
 * a compile error.
 *
 * Console: `catalogFor` in `./catalogs.ts` serves the app `translation`
 * namespace; `uiCatalogFor` here serves the `ui` namespace.
 */

import type { SupportedLanguage } from "../core.ts"
import de from "../ui/de.json"
import en from "../ui/en.json"
import es from "../ui/es.json"
import ja from "../ui/ja.json"
import zh from "../ui/zh.json"

export const UI_CATALOGS = { en, zh, ja, de, es } as const satisfies Record<
	SupportedLanguage,
	typeof en
>

/** Resolve the ui catalog for the active language; undefined → English. */
export function uiCatalogFor(
	language: SupportedLanguage | undefined,
): typeof en {
	return language === undefined ? en : UI_CATALOGS[language]
}
