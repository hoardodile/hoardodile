import type { ClientPlatform } from "@hoardodile/schemas"
import { cn } from "@hoardodile/ui/lib/utils"
import { useTranslation } from "react-i18next"
import { z } from "zod"

export type UsagePlatformFilterValue = "all" | ClientPlatform

/** URL-search schema for the platform filter — shared by every
 *  platform-filtered route so the value round-trips through the URL. */
export const usagePlatformFilterSchema = z.enum([
	"all",
	"web-mobile",
	"web-pc",
	"desktop",
])

export function usagePlatformFilterParam(
	platform: UsagePlatformFilterValue,
): ClientPlatform | undefined {
	return platform === "all" ? undefined : platform
}

type UsagePlatformFilterProps = {
	readonly value: UsagePlatformFilterValue
	readonly onChange: (value: UsagePlatformFilterValue) => void
}

const OPTIONS: { value: UsagePlatformFilterValue; labelKey: string }[] = [
	{ value: "all", labelKey: "usage.stats.platformAll" },
	{ value: "web-mobile", labelKey: "usage.stats.platformWebMobile" },
	{ value: "web-pc", labelKey: "usage.stats.platformWebPc" },
	{ value: "desktop", labelKey: "usage.stats.platformDesktop" },
]

export function UsagePlatformFilter(props: UsagePlatformFilterProps) {
	const { value, onChange } = props
	const { t } = useTranslation()

	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-xs font-medium text-muted-foreground">
				{t("usage.stats.platformFilter")}
			</span>
			<div className="flex flex-wrap gap-2">
				{OPTIONS.map((option) => (
					<button
						key={option.value}
						type="button"
						onClick={() => onChange(option.value)}
						className={cn(
							"rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
							value === option.value
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground hover:bg-muted/80",
						)}
					>
						{t(option.labelKey)}
					</button>
				))}
			</div>
		</div>
	)
}
