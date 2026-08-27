import type { SupportedLanguage } from "@hoardodile/i18n"
import { catalogFor } from "@hoardodile/i18n/catalogs"

/** Generic message shown when the server cannot be reached. */
export function serverErrorMessage(
	language: SupportedLanguage | undefined,
): string {
	return catalogFor(language).desktopShell.errorPage.serverError
}

/** Dev-specific message: the window lost the Vite dev server, not the sidecar. */
export function devServerErrorMessage(
	language: SupportedLanguage | undefined,
): string {
	return catalogFor(language).desktopShell.errorPage.devServerError
}

/** Message shown when the renderer process crashed (Crash, OOM, kill). */
export function rendererCrashedMessage(
	language: SupportedLanguage | undefined,
): string {
	return catalogFor(language).desktopShell.errorPage.rendererCrashed
}
