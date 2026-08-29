import type en from "./catalogs/en.json"
import type uiEn from "./ui/en.json"

/**
 * Type the `t()` keys of every consumer against the catalogs: a wrong key
 * (typo or a key added to one catalog but not the others) becomes a
 * compile error instead of a silently rendered key name. Declared once
 * here so the web SPA, the desktop surfaces, the workbench and the plugin
 * SDK all resolve the same resources. The `plugin` namespace is typed
 * loosely on purpose — its strings are authored per plugin (their
 * bundles vary), and `@hoardodile/sdk-react`'s `useTranslation` wrapper
 * returns that loose signature to plugin code.
 */
declare module "i18next" {
	interface CustomTypeOptions {
		defaultNS: "translation"
		resources: {
			translation: typeof en
			ui: typeof uiEn
			plugin: Record<string, string>
		}
		returnNull: false
		returnEmptyString: false
	}
}

import type { i18n as I18nInstance } from "i18next"
import { UI_CATALOGS } from "./catalogs/ui.ts"
import { CATALOGS } from "./catalogs.ts"
import { SUPPORTED_LANGUAGES } from "./core.ts"
import {
	type CreateI18nOptions,
	createI18n as createI18nCore,
} from "./create-i18n.ts"

/**
 * Host-surface factory: an i18next instance preloaded with the shared
 * catalogs (`translation` + `ui`, all five languages). React roots boot
 * it with the same options everywhere. Plugin iframes use the `createI18n`
 * factory from `@hoardodile/i18n/create-i18n` instead with a resource
 * subset (ui + plugin namespaces) so the full app catalog never enters
 * their bundles.
 */
export function createI18n(
	options?: Omit<CreateI18nOptions, "resources">,
): I18nInstance {
	return createI18nCore({
		resources: Object.fromEntries(
			SUPPORTED_LANGUAGES.map((language) => [
				language,
				{ translation: CATALOGS[language], ui: UI_CATALOGS[language] },
			]),
		),
		...options,
	})
}

export { UI_CATALOGS, uiCatalogFor } from "./catalogs/ui.ts"
export { CATALOGS, catalogFor } from "./catalogs.ts"
export {
	isSupportedLanguage,
	LANGUAGE_LABEL_KEYS,
	resolveSystemLanguage,
	SUPPORTED_LANGUAGES,
	type SupportedLanguage,
} from "./core.ts"
export type { CreateI18nOptions } from "./create-i18n.ts"
