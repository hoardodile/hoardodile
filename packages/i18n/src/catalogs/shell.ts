/**
 * The shell catalog registry: the tiny subset of strings the Electron
 * **main process** needs (the `desktopShell` namespace for the tray,
 * dialogs, error pages and wizard, plus the `closeConfirm` block it uses
 * for the native close dialog). Bundling only this subset instead of the
 * whole app `translation` catalog keeps the shell bundle — and therefore
 * the `out/main` bytes the resource channel hashes — stable against
 * app/web string churn.
 *
 * The five JSON modules must stay in lockstep with each other and stay a
 * subset of the source catalogs (`parity.test.ts` enforces both), so a
 * shell string can never drift from the app/`ui` catalogs.
 */

import type { SupportedLanguage } from "../core.ts"
import de from "../shell/de.json"
import en from "../shell/en.json"
import es from "../shell/es.json"
import ja from "../shell/ja.json"
import zh from "../shell/zh.json"

export const SHELL_CATALOGS = { en, zh, ja, de, es } as const satisfies Record<
	SupportedLanguage,
	typeof en
>

/** Resolve the shell catalog for the active language; undefined → English. */
export function shellCatalogFor(
	language: SupportedLanguage | undefined,
): typeof en {
	return language === undefined ? en : SHELL_CATALOGS[language]
}
