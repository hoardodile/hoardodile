import { ensureHostBridge, getPluginContext } from "@hoardodile/sdk-web"
import { useEffect, useState } from "react"

type RawBundle = Record<string, unknown>

type FlatBundle = Record<string, string>

type InterpolationVars = Record<string, string | number>

type PluginTranslation = {
	readonly t: (key: string, vars?: InterpolationVars) => string
	readonly language: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

function flattenMessages(
	obj: Record<string, unknown>,
	prefix = "",
): Record<string, string> {
	const result: Record<string, string> = {}
	for (const [key, value] of Object.entries(obj)) {
		const fullKey = prefix !== "" ? `${prefix}.${key}` : key
		if (isPlainObject(value)) {
			Object.assign(result, flattenMessages(value, fullKey))
		} else {
			result[fullKey] = String(value)
		}
	}
	return result
}

function interpolate(template: string, vars?: InterpolationVars): string {
	if (vars === undefined) return template
	let result = template
	for (const [k, v] of Object.entries(vars)) {
		result = result.replaceAll(`{{${k}}}`, String(v))
	}
	return result
}

function resolveLocale(lang: string, available: Set<string>): string {
	if (available.has(lang)) return lang
	const base = lang.split("-")[0]!
	if (available.has(base)) return base
	return "en"
}

function resolveInitialLanguage(bundles: Record<string, FlatBundle>): string {
	const ctx = getPluginContext()
	if (ctx === undefined) return "en"
	return resolveLocale(ctx.language, new Set(Object.keys(bundles)))
}

/**
 * Creates a `useTranslation` hook backed by the given locale bundles.
 * The initial language is read from the plugin context and updated when
 * the host sends a `languageChanged` push.
 *
 * Translation values support `{{var}}` interpolation placeholders.
 */
export function createPluginTranslation(bundles: Record<string, RawBundle>): {
	readonly useTranslation: () => PluginTranslation
} {
	const flat: Record<string, FlatBundle> = {}
	const availableLocales = new Set<string>()
	for (const [lang, bundle] of Object.entries(bundles)) {
		flat[lang] = flattenMessages(bundle)
		availableLocales.add(lang)
	}

	function useTranslation(): PluginTranslation {
		const [language, setLanguage] = useState(() => resolveInitialLanguage(flat))

		useEffect(function subscribeToLanguageChanges() {
			return ensureHostBridge().subscribe(
				"languageChanged",
				function handle(data) {
					setLanguage(resolveLocale(data.language, availableLocales))
				},
			)
		}, [])

		function t(key: string, vars?: InterpolationVars): string {
			const bundle = flat[language] ?? flat.en ?? {}
			return interpolate(bundle[key] ?? key, vars)
		}

		return { t, language }
	}

	return { useTranslation }
}
