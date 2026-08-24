import { uiCatalogFor } from "@hoardodile/i18n/catalogs/ui"
import { isSupportedLanguage, SUPPORTED_LANGUAGES } from "@hoardodile/i18n/core"
import { createI18n } from "@hoardodile/i18n/create-i18n"
import { ensureHostBridge, getPluginContext } from "@hoardodile/sdk-web"
import type { Resource } from "i18next"
import { useEffect } from "react"
import { setI18n, useTranslation as useReactTranslation } from "react-i18next"

type RawBundle = Record<string, unknown>

type InterpolationVars = Record<string, string | number>

type PluginTranslation = {
	readonly t: (key: string, vars?: InterpolationVars) => string
	readonly language: string
}

function resolveLocale(lang: string, available: Set<string>): string {
	if (available.has(lang)) return lang
	const base = lang.split("-")[0]!
	if (available.has(base)) return base
	return "en"
}

/**
 * Creates a `useTranslation` hook backed by the given locale bundles plus
 * the shared `ui` catalog namespace (so `@hoardodile/ui` components
 * render localized chrome in every supported host language).
 *
 * Backed by i18next/react-i18next with the same options as the host
 * surfaces: the language follows the plugin context, updates when the
 * host sends a `languageChanged` push, interpolates `{{var}}`
 * placeholders, and falls back to English (via `fallbackLng`) for
 * languages the plugin's own bundle does not ship.
 */
export function createPluginTranslation(bundles: Record<string, RawBundle>): {
	readonly useTranslation: () => PluginTranslation
} {
	const availableLangs = new Set<string>([
		...Object.keys(bundles),
		...SUPPORTED_LANGUAGES,
	])

	// The small shared `ui` namespace (every supported language, so ui
	// chrome always matches the host language) plus the plugin's own
	// `plugin` namespace — never the full app catalog (the iframe bundle
	// stays a fraction of the SPA's i18n payload).
	const resources: Resource = {}
	for (const language of availableLangs) {
		const base = language.split("-")[0]!
		resources[language] = {
			...(isSupportedLanguage(base) ? { ui: uiCatalogFor(base) } : {}),
			...(bundles[language] === undefined ? {} : { plugin: bundles[language] }),
		}
	}

	const initial = resolveLocale(
		getPluginContext()?.language ?? "en",
		availableLangs,
	)
	const instance = createI18n({ lng: initial, resources })

	// Bind as react-i18next's default instance so every `@hoardodile/ui`
	// component rendered in this iframe resolves the same instance.
	setI18n(instance)

	let subscribed = false
	function subscribeToLanguageChanges(): void {
		if (subscribed) return
		subscribed = true
		ensureHostBridge().subscribe("languageChanged", (data) => {
			// The wire payload is a bare language-code string (predates the
			// typed protocol table); accept the legacy object shape too so
			// plugins compiled against either contract keep switching.
			const language =
				typeof data === "string"
					? data
					: String((data as { language?: string }).language ?? "")
			void instance.changeLanguage(resolveLocale(language, availableLangs))
		})
	}

	function useTranslation(): PluginTranslation {
		useEffect(subscribeToLanguageChanges, [])
		const { t, i18n } = useReactTranslation("plugin", {
			i18n: instance,
			useSuspense: false,
		})
		return {
			t: t as unknown as PluginTranslation["t"],
			language: i18n.resolvedLanguage ?? i18n.language,
		}
	}

	return { useTranslation }
}
