/**
 * The i18next instance factory every React root uses: the web SPA, the
 * desktop wizard/shell pages, the workbench and the plugin SDK iframes
 * all boot their instance with the same options so catalog behavior
 * (fallback, plurals, interpolation, type safety) never diverges between
 * surfaces.
 *
 * This module is deliberately free of catalog imports — plugin iframe
 * bundles import the factory through this subpath and ship only the
 * small `ui`/`plugin` namespaces (the full app catalog would otherwise
 * be pulled into every bundle). Host surfaces use `createI18n` from
 * `@hoardodile/i18n`, which wraps this factory with the shared catalogs.
 *
 * React-free on purpose: the Electron main process and the sandboxed
 * preload keep using `catalogFor` / `uiCatalogFor` directly, and each
 * React root adds its own `react-i18next` binding (e.g.
 * `setI18n(instance)`).
 */

import i18next, { type i18n as I18nInstance, type InitOptions } from "i18next"
import { SUPPORTED_LANGUAGES } from "./core.ts"

export type CreateI18nOptions = Omit<InitOptions, "lng" | "resources"> & {
	/** Initial language; undefined lets i18next resolve its default (fallback → "en"). */
	readonly lng?: string
	/** Resource map — the shared catalogs (or the smaller ui/plugin set). */
	readonly resources: InitOptions["resources"]
}

/**
 * Create an i18next instance with the canonical option set. Callers
 * supply the resources explicitly (hosts via the `@hoardodile/i18n`
 * wrapper, plugins via the SDK).
 */
export function createI18n(options: CreateI18nOptions): I18nInstance {
	const { lng, resources, ...rest } = options
	const instance = i18next.createInstance()
	void instance.init({
		resources,
		lng,
		fallbackLng: "en",
		supportedLngs: [...SUPPORTED_LANGUAGES],
		nonExplicitSupportedLngs: true,
		interpolation: { escapeValue: false },
		returnNull: false,
		returnEmptyString: false,
		compatibilityJSON: "v4",
		pluralSeparator: "_",
		...rest,
	} satisfies InitOptions)
	return instance
}
