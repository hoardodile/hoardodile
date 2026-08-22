import { Icon } from "@hoardodile/ui/components/icon"
import { Monitor, Smartphone, WindowFrame } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { detectPlatform } from "../detectPlatform"

const PLATFORM_ICONS = {
	"web-mobile": Smartphone,
	"web-pc": Monitor,
	desktop: WindowFrame,
}

/**
 * Current-device pill shown in the stats header: the muted
 * fill pill with the platform glyph and "Web · PC"-style label.
 */
export function CurrentPlatformPill() {
	const { t } = useTranslation()
	const platform = detectPlatform()
	return (
		<span
			title={t("usage.stats.currentPlatform.title")}
			className="inline-flex h-control shrink-0 items-center gap-1.5 rounded-lg bg-muted px-3 text-ui text-secondary-foreground"
			data-testid="stats-current-platform"
		>
			<Icon icon={PLATFORM_ICONS[platform]} className="text-muted-foreground" />
			{t(`usage.stats.platformPill.${platform}`)}
		</span>
	)
}
