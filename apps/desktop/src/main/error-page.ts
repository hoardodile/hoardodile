import type { SupportedLanguage } from "@hoardodile/shared/i18n"
import en from "@hoardodile/shared/i18n/en.json"
import zh from "@hoardodile/shared/i18n/zh.json"

function catalog(language: SupportedLanguage | undefined) {
	return language === "zh" ? zh : en
}

/** Generic message shown when the server cannot be reached. */
export function serverErrorMessage(
	language: SupportedLanguage | undefined,
): string {
	return catalog(language).desktopShell.errorPage.serverError
}

/** Dev-specific message: the window lost the Vite dev server, not the sidecar. */
export function devServerErrorMessage(
	language: SupportedLanguage | undefined,
): string {
	return catalog(language).desktopShell.errorPage.devServerError
}
