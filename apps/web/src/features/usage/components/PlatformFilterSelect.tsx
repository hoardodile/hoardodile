import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { useTranslation } from "react-i18next"
import type { UsagePlatformFilterValue } from "./UsagePlatformFilter"

const PLATFORM_OPTIONS: {
	value: UsagePlatformFilterValue
	labelKey: string
}[] = [
	{ value: "all", labelKey: "usage.stats.platformAll" },
	{ value: "web-mobile", labelKey: "usage.stats.platformWebMobile" },
	{ value: "web-pc", labelKey: "usage.stats.platformWebPc" },
	{ value: "desktop", labelKey: "usage.stats.platformDesktop" },
]

/**
 * The muted platform-filter chip: "All platforms" by default,
 * "Web mobile" / "Web PC" / "Desktop" on pick. Shared by the stats,
 * footprints and usage-history headers so all pages speak the same
 * platform vocabulary.
 */
export function PlatformFilterSelect(props: {
	readonly value: UsagePlatformFilterValue
	readonly onChange: (value: UsagePlatformFilterValue) => void
}) {
	const { value, onChange } = props
	const { t } = useTranslation()

	return (
		<DropdownSelect
			value={value}
			onValueChange={(next) => onChange(next as UsagePlatformFilterValue)}
			options={PLATFORM_OPTIONS.map((option) => ({
				value: option.value,
				label: t(option.labelKey),
			}))}
			aria-label={t("usage.stats.platformFilter")}
			data-testid="platform-filter-select"
		/>
	)
}
