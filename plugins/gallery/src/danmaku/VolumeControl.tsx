import { Button } from "@hoardodile/ui/components/button"
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@hoardodile/ui/components/popover"
import { Slider } from "@hoardodile/ui/components/slider"
import { VolumeCrossIcon as VolumeCross } from "@solar-icons/react/linear/volume-cross"
import { VolumeLoudIcon as VolumeLoud } from "@solar-icons/react/linear/volume-loud"
import { useTranslation } from "../i18n"
import { usePlayerPortalContainer } from "./PlayerPortalContext"

export function VolumeControl(props: {
	readonly volume: number
	readonly muted: boolean
	readonly onToggleMute: () => void
	readonly onVolumeChange: (values: number | readonly number[]) => void
	readonly onOpenChange?: (open: boolean) => void
}) {
	const { volume, muted, onToggleMute, onVolumeChange, onOpenChange } = props
	const { t } = useTranslation()
	const portalContainer = usePlayerPortalContainer()
	const Icon = muted || volume === 0 ? VolumeCross : VolumeLoud
	return (
		<Popover onOpenChange={onOpenChange}>
			<PopoverTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label={t("player.volume")}
						className="size-8 rounded-full text-white/90 transition-none hover:bg-white/15 hover:text-white"
					>
						<Icon className="size-4.5" />
					</Button>
				}
			/>
			<PopoverContent
				container={portalContainer}
				side="top"
				align="center"
				className="flex h-50 w-11 flex-col items-center gap-2 overflow-hidden rounded-full p-2.5"
			>
				<Slider
					orientation="vertical"
					value={[muted ? 0 : volume]}
					min={0}
					max={1}
					step={0.01}
					onValueChange={onVolumeChange}
					aria-label={t("player.volume")}
				/>
				<button
					type="button"
					className="select-none font-mono text-tiny text-muted-foreground hover:text-primary"
					onClick={onToggleMute}
				>
					{Math.round((muted ? 0 : volume) * 100)}
				</button>
			</PopoverContent>
		</Popover>
	)
}
