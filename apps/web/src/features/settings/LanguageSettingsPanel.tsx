import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { useTranslation } from "react-i18next"
import {
	isSupportedLanguage,
	resolveSystemLanguage,
	SUPPORTED_LANGUAGES,
	type SupportedLanguage,
} from "@/i18n"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"

const LANGUAGE_LABEL_KEY = {
	en: "language.english",
	zh: "language.chinese",
	ja: "language.japanese",
	de: "language.german",
	es: "language.spanish",
} as const satisfies Record<SupportedLanguage, string>

/**
 * Settings panel for selecting the active UI language. Persists the choice
 * via {@link prefSync} so it survives reloads and syncs to the server.
 */
export function LanguageSettingsPanel() {
	const { t, i18n } = useTranslation()
	const current = resolveSystemLanguage(i18n.resolvedLanguage ?? i18n.language)

	function handleSelect(code: SupportedLanguage) {
		i18n.changeLanguage(code)
		prefSync.set(prefKeys.language, code)
	}

	return (
		<DropdownSelect
			value={current}
			onValueChange={(next) => {
				if (isSupportedLanguage(next)) handleSelect(next)
			}}
			options={SUPPORTED_LANGUAGES.map((code) => ({
				value: code,
				label: t(LANGUAGE_LABEL_KEY[code]),
			}))}
			aria-label={t("language.label")}
			data-testid="language-select"
		/>
	)
}
