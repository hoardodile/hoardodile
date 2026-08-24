import { I18nextProvider, setI18n } from "react-i18next"

/**
 * React binding shared by every host surface. Import the provider and
 * `setI18n` from HERE (not from `react-i18next`) so the provider and
 * `@hoardodile/ui` components resolve the SAME react-i18next context
 * instance: the workspace pins two typescript toolchains and pnpm
 * therefore keeps two physical copies of react-i18next (keyed by peer
 * context), so react-i18next's module-global default instance must NOT
 * be relied on across package boundaries — hosts pass the instance
 * explicitly.
 *
 * The `@hoardodile/ui` components call `useTranslation("ui")` against
 * this context; host roots wrap their tree with the provider:
 *
 * ```tsx
 * <I18nProvider i18n={i18n}>
 *   <App />
 * </I18nProvider>
 * ```
 *
 * Test setups that cannot wrap a provider bind the same instance here so
 * ui components still resolve it.
 */
export { I18nextProvider as I18nProvider, setI18n }
