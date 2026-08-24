/**
 * The workbench catalog registry: dev-tool chrome strings (the offline
 * plugin workbench's own UI — toolbar, config popover, empty states).
 * Unlike the `ui` namespace these are never bundled by the app or the
 * plugin SDK; only the workbench imports this subpath. Same lockstep
 * rules as the other catalogs; `parity.test.ts` enforces them.
 */

import type { SupportedLanguage } from "../core.ts"
import de from "../workbench/de.json"
import en from "../workbench/en.json"
import es from "../workbench/es.json"
import ja from "../workbench/ja.json"
import zh from "../workbench/zh.json"

export const WORKBENCH_CATALOGS = {
	en,
	zh,
	ja,
	de,
	es,
} as const satisfies Record<SupportedLanguage, typeof en>

/** Resolve the workbench catalog for the active language; undefined → English. */
export function workbenchCatalogFor(
	language: SupportedLanguage | undefined,
): typeof en {
	return language === undefined ? en : WORKBENCH_CATALOGS[language]
}
