import {
	createI18n,
	resolveSystemLanguage,
	type SupportedLanguage,
} from "@hoardodile/i18n"

/**
 * The wizard/shell-page i18n instance. Shell pages render before the SPA
 * ever loads, so they boot their own instance from the same shared
 * catalogs (system locale first, then the language the SPA pushes via
 * `desktop.getLanguage()`). `@hoardodile/ui` components receive it via
 * `<I18nProvider>` in `main.tsx`.
 */
export const i18n = createI18n({
	lng: resolveSystemLanguage(navigator.language),
})

/** Apply the language the SPA pushed (or the system locale) to the instance. */
export function applyLanguage(language: SupportedLanguage | undefined): void {
	if (language !== undefined) void i18n.changeLanguage(language)
}
