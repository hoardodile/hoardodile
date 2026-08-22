import { Button } from "@hoardodile/ui/components/button"
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@hoardodile/ui/components/popover"
import { SettingsIcon as Settings } from "@solar-icons/react/linear/settings"
import { useTranslation } from "../i18n"
import { usePlayerPortalContainer } from "./PlayerPortalContext"
import { DisplayOptions, type DisplayOptionsProps } from "./settings-options"

type Props = DisplayOptionsProps & {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}

export function DisplaySettingsPopover(props: Props) {
	const {
		engine,
		fitMode,
		autoplay,
		onEngineChange,
		onFitModeChange,
		onAutoplayChange,
		open,
		onOpenChange,
	} = props
	const { t } = useTranslation()
	const portalContainer = usePlayerPortalContainer()
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label={t("player.displaySettings")}
						className="size-8 rounded-full text-white/90 transition-none hover:bg-white/15 hover:text-white"
					>
						<Settings className="size-4.5" />
					</Button>
				}
			/>
			<PopoverContent
				container={portalContainer}
				side="top"
				align="end"
				className="flex w-56 flex-col gap-3 p-3"
			>
				<DisplayOptions
					engine={engine}
					fitMode={fitMode}
					autoplay={autoplay}
					onEngineChange={onEngineChange}
					onFitModeChange={onFitModeChange}
					onAutoplayChange={onAutoplayChange}
				/>
			</PopoverContent>
		</Popover>
	)
}
