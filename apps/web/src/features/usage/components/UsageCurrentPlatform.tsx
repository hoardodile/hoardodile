import { Icon } from "@hoardodile/ui/components/icon"
import { Monitor, Smartphone, WindowFrame } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { detectPlatform } from "../detectPlatform"

const PLATFORM_ICONS = {
	"web-mobile": Smartphone,
	"web-pc": Monitor,
	desktop: WindowFrame,
}

export function UsageCurrentPlatform() {
	const { t } = useTranslation()
	const platform = detectPlatform()
	const PlatformIcon = PLATFORM_ICONS[platform]

	return (
		<div className="flex flex-col gap-2" data-testid="usage-current-platform">
			<span className="text-xs font-medium text-muted-foreground">
				{t("usage.stats.currentPlatform.title")}
			</span>
			<div className="flex items-center gap-2">
				<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
					<Icon icon={PlatformIcon} className="text-muted-foreground" />
				</div>
				<span className="truncate text-sm font-medium">
					{t(`usage.stats.currentPlatform.${platform}`)}
				</span>
			</div>
		</div>
	)
}
