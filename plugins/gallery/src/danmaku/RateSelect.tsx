import { Button } from "@hoardodile/ui/components/button"
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { useTranslation } from "../i18n"
import { usePlayerPortalContainer } from "./PlayerPortalContext"
import { PLAYBACK_RATES } from "./types"

export function RateSelect(props: {
	readonly rate: number
	readonly onChange: (rate: number) => void
	readonly onApply: (rate: number) => void
	readonly open?: boolean
	readonly onOpenChange?: (open: boolean) => void
}) {
	const { rate, onChange, onApply, open, onOpenChange } = props
	const { t } = useTranslation()
	const portalContainer = usePlayerPortalContainer()
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger
				render={
					<Button
						size="sm"
						variant="ghost"
						aria-label={t("player.speed")}
						className="h-8 min-w-14 gap-1 border-0 bg-white/10 px-3 text-xs font-medium text-white shadow-none hover:bg-white/20 hover:text-white focus-visible:ring-1 focus-visible:ring-white/30"
					>
						{t("player.speedValue", { rate })}
					</Button>
				}
			/>
			<DropdownMenuContent container={portalContainer} align="end">
				{PLAYBACK_RATES.map((r) => (
					<DropdownMenuCheckboxItem
						key={r}
						checked={r === rate}
						onCheckedChange={(checked) => {
							if (checked !== true) return
							onChange(r)
							onApply(r)
						}}
					>
						{t("player.speedValue", { rate: r })}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
