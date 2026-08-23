import type { SupportedLanguage } from "@hoardodile/shared/i18n"
import { catalogFor } from "@hoardodile/shared/i18n/catalogs"

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
