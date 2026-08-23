import type { UsageExposureMode } from "@hoardodile/schemas"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { useTranslation } from "react-i18next"
import { loose } from "@/i18n"

const EXPOSURE_OPTIONS: { value: UsageExposureMode; labelKey: string }[] = [
	{ value: "direct", labelKey: "usage.stats.exposureTime.direct" },
	{ value: "associated", labelKey: "usage.stats.exposureTime.associated" },
	{ value: "total", labelKey: "usage.stats.exposureTime.total" },
]

/**
 * The exposure-mode chip: "Direct time" by default, with the
 * associated and total counting modes. Sits in the stats header next to
 * the platform filter.
 */
export function ExposureModeSelect(props: {
	readonly value: UsageExposureMode
	readonly onChange: (value: UsageExposureMode) => void
}) {
	const { value, onChange } = props
	const { t } = useTranslation()

	return (
		<DropdownSelect
			value={value}
			onValueChange={(next) => onChange(next as UsageExposureMode)}
			options={EXPOSURE_OPTIONS.map((option) => ({
				value: option.value,
				label: loose(t)(option.labelKey),
			}))}
			aria-label={t("usage.stats.exposureMode")}
			data-testid="exposure-mode-select"
		/>
	)
}
