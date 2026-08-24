import {
	CATALOGS,
	resolveSystemLanguage,
	SUPPORTED_LANGUAGES,
	type SupportedLanguage,
	UI_CATALOGS,
} from "@hoardodile/i18n"
import { createI18n } from "@hoardodile/i18n/create-i18n"
import { WORKBENCH_CATALOGS } from "@hoardodile/i18n/workbench"

/**
 * The wizard-like workbench chrome i18n instance: the shared
 * `translation` + `ui` catalogs plus the workbench's own `workbench`
 * namespace (dev-tool copy authored in the shared package and
 * parity-checked there). Booted with the system locale first; `App`
 * calls `applyLanguage`/`changeLanguage` when the configured language
 * changes. `@hoardodile/ui` components receive it via `<I18nProvider>`
 * in `main.tsx`.
 */
export const i18n = createI18n({
	lng: resolveSystemLanguage(navigator.language),
	resources: Object.fromEntries(
		SUPPORTED_LANGUAGES.map((language) => [
			language,
			{
				translation: CATALOGS[language],
				ui: UI_CATALOGS[language],
				workbench: WORKBENCH_CATALOGS[language],
			},
		]),
	),
})

/** Apply the configured language to the instance. */
export function applyLanguage(language: SupportedLanguage | undefined): void {
	if (language !== undefined) void i18n.changeLanguage(language)
}
