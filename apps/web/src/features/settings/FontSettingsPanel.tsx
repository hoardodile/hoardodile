import { useTranslation } from "react-i18next"
import { FontPicker } from "@/components/common/FontPicker"
import { useFont } from "@/components/common/FontProvider"

/**
 * Settings panel for picking the global application font stack used for
 * body text.
 */
export function FontSettingsPanel() {
	const { t } = useTranslation()
	const { appFonts, setAppFonts } = useFont()

	return (
		<FontPicker
			value={appFonts}
			onChange={setAppFonts}
			data-testid="app-font-picker"
			aria-label={t("font.label")}
		/>
	)
}
