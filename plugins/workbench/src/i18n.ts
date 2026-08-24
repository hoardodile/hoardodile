import { createI18n } from "@hoardodile/i18n"

/**
 * The workbench chrome i18n instance (shared `ui`/`translation` catalogs).
 * `App` calls `i18n.changeLanguage` when the language setting changes;
 * `@hoardodile/ui` components (e.g. the plugin download consent dialog)
 * receive it via `<I18nProvider>` in `main.tsx`.
 */
export const i18n = createI18n()
