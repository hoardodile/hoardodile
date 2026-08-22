import type { UsageExposureMode } from "@hoardodile/schemas"
import { cn } from "@hoardodile/ui/lib/utils"
import { useTranslation } from "react-i18next"

const EXPOSURE_MODES: readonly {
	readonly value: UsageExposureMode
	readonly labelKey: string
}[] = [
	{ value: "direct", labelKey: "usage.stats.exposureDirect" },
	{ value: "associated", labelKey: "usage.stats.exposureAssociated" },
	{ value: "total", labelKey: "usage.stats.exposureTotal" },
]

export type UsageExposureModeToggleProps = {
	readonly value: UsageExposureMode
	readonly onChange: (value: UsageExposureMode) => void
}

export function UsageExposureModeToggle(props: UsageExposureModeToggleProps) {
	const { value, onChange } = props
	const { t } = useTranslation()

	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-xs font-medium text-muted-foreground">
				{t("usage.stats.exposureMode")}
			</span>
			<div className="flex flex-wrap gap-2">
				{EXPOSURE_MODES.map((mode) => (
					<button
						key={mode.value}
						type="button"
						onClick={() => onChange(mode.value)}
						className={cn(
							"rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
							value === mode.value
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground hover:bg-muted/80",
						)}
					>
						{t(mode.labelKey)}
					</button>
				))}
			</div>
		</div>
	)
}
