import { PillTabs } from "@hoardodile/ui/components/pill-tabs"
import { useTranslation } from "react-i18next"
import {
	ICON_STYLES,
	type IconStyle,
	useIconStyle,
} from "@/components/common/IconStyleProvider"

const STYLE_LABEL_KEY = {
	duotone: "icons.style.duotone",
	grayscale: "icons.style.grayscale",
	linear: "icons.style.linear",
} as const satisfies Record<IconStyle, string>

/**
 * Settings panel for choosing how icons render: duotone (palette hue
 * second tone), grayscale (two tones in plain ink) or linear (thin-line
 * Linear glyphs). Persisted via {@link IconStyleProvider} as
 * `data-icon-style` on `<html>`.
 */
export function IconSettingsPanel() {
	const { t } = useTranslation()
	const { iconStyle, setIconStyle } = useIconStyle()

	return (
		<PillTabs
			value={iconStyle}
			onChange={setIconStyle}
			className="flex-wrap justify-start"
			items={ICON_STYLES.map((style) => ({
				value: style,
				label: t(STYLE_LABEL_KEY[style]),
				testId: `icon-style-${style}`,
				ariaPressed: style === iconStyle,
			}))}
		/>
	)
}
