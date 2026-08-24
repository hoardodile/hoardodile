import { createI18n } from "@hoardodile/i18n"
import { I18nProvider } from "@hoardodile/i18n/react"
import { render } from "@testing-library/react"
import type { ReactElement } from "react"

/**
 * Shared English i18n instance for component tests. Bind it explicitly
 * through the provider (never via react-i18next's module-global default:
 * the workspace keeps more than one physical react-i18next copy, so the
 * global instance is only reliable within a single package).
 */
export const testI18n = createI18n()

/** Render with the shared i18n instance so components resolve the `ui`
 *  namespace. Tests that assert non-English copy call `changeLanguage`
 *  on {@link testI18n} and restore `"en"` afterwards. */
export function renderWithI18n(
	ui: ReactElement,
	options?: Parameters<typeof render>[1],
): ReturnType<typeof render> {
	return render(<I18nProvider i18n={testI18n}>{ui}</I18nProvider>, options)
}
