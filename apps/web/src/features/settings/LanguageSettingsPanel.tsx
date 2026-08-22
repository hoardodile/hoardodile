import { PillTabs } from "@hoardodile/ui/components/pill-tabs"
import { useTranslation } from "react-i18next"
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/i18n"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"

const LANGUAGE_LABEL_KEY = {
	en: "language.english",
	zh: "language.chinese",
} as const satisfies Record<SupportedLanguage, string>

/**
 * Settings panel for selecting the active UI language. Persists the choice
 * via {@link prefSync} so it survives reloads and syncs to the server.
 */
export function LanguageSettingsPanel() {
	const { t, i18n } = useTranslation()
	const current = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language)

	function handleSelect(code: SupportedLanguage) {
		i18n.changeLanguage(code)
		prefSync.set(prefKeys.language, code)
	}

	function handleLanguageChange(next: string) {
		if (isSupportedLanguage(next)) handleSelect(next)
	}

	return (
		<PillTabs
			value={current}
			onChange={handleLanguageChange}
			className="flex-wrap justify-start"
			items={SUPPORTED_LANGUAGES.map((code) => ({
				value: code,
				label: t(LANGUAGE_LABEL_KEY[code]),
				testId: `language-option-${code}`,
				className: "px-4",
			}))}
		/>
	)
}

function isSupportedLanguage(value: string): value is SupportedLanguage {
	for (const code of SUPPORTED_LANGUAGES) {
		if (code === value) return true
	}
	return false
}

function normalizeLanguage(raw: string): SupportedLanguage {
	const base = raw.toLowerCase().split("-")[0]
	if (base === "zh") return "zh"
	return "en"
}
