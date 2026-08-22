import { Button } from "@hoardodile/ui/components/button"
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@hoardodile/ui/components/popover"
import { CameraIcon as Camera } from "@solar-icons/react/linear/camera"
import { MenuDotsIcon as MenuDots } from "@solar-icons/react/linear/menu-dots"
import { SquareBottomUpIcon as SquareBottomUp } from "@solar-icons/react/linear/square-bottom-up"
import { useTranslation } from "../i18n"
import { usePlayerPortalContainer } from "./PlayerPortalContext"
import { RateSelect } from "./RateSelect"
import { DisplayOptions, type DisplayOptionsProps } from "./settings-options"

type Props = DisplayOptionsProps & {
	readonly rate: number
	readonly onRateChange: (rate: number) => void
	readonly onApplyRate: (rate: number) => void
	readonly onScreenshot: () => void
	readonly onTogglePip: () => void
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}

export function MoreControlsPopover(props: Props) {
	const {
		rate,
		onRateChange,
		onApplyRate,
		onScreenshot,
		onTogglePip,
		open,
		onOpenChange,
		...displayOptions
	} = props
	const { t } = useTranslation()
	const portalContainer = usePlayerPortalContainer()
	function handleOpenChange(
		nextOpen: boolean,
		eventDetails?: Parameters<
			NonNullable<React.ComponentProps<typeof Popover>["onOpenChange"]>
		>[1],
	) {
		// The nested rate DropdownMenu renders its content in a
		// portal that lives outside this popover's DOM
		// subtree. Without this guard, touching a rate option on
		// mobile would register as an outside interaction and
		// close the surrounding popover before the menu handled
		// the tap, dismissing both layers and losing the rate
		// change.
		if (
			!nextOpen &&
			eventDetails?.reason === "outside-press" &&
			eventDetails.event.target instanceof Element &&
			eventDetails.event.target.closest("[data-slot=dropdown-menu-content]") !==
				null
		) {
			eventDetails.cancel()
			return
		}
		onOpenChange(nextOpen)
	}
	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label={t("player.more")}
						className="size-8 rounded-full text-white/90 transition-none hover:bg-white/15 hover:text-white"
					>
						<MenuDots className="size-4.5" />
					</Button>
				}
			/>
			<PopoverContent
				container={portalContainer}
				side="top"
				align="end"
				className="flex w-64 flex-col gap-3 p-3"
			>
				<RowItem label={t("player.speed")}>
					<RateSelect
						rate={rate}
						onChange={onRateChange}
						onApply={onApplyRate}
					/>
				</RowItem>
				<DisplayOptions {...displayOptions} />
				<MoreActionRow
					label={t("player.screenshot")}
					icon={<Camera className="size-4" />}
					onClick={onScreenshot}
				/>
				<MoreActionRow
					label={t("player.pip")}
					icon={<SquareBottomUp className="size-4" />}
					onClick={onTogglePip}
				/>
			</PopoverContent>
		</Popover>
	)
}

function RowItem(props: {
	readonly label: string
	readonly children: React.ReactNode
}) {
	return (
		<div className="flex items-center justify-between gap-2">
			<span className="text-xs text-muted-foreground">{props.label}</span>
			{props.children}
		</div>
	)
}

function MoreActionRow(props: {
	readonly label: string
	readonly icon: React.ReactNode
	readonly active?: boolean
	readonly onClick: () => void
}) {
	const { label, icon, active, onClick } = props
	return (
		<button
			type="button"
			onClick={onClick}
			data-active={active ? "true" : "false"}
			className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent data-[active=true]:text-primary"
		>
			{icon}
			<span>{label}</span>
		</button>
	)
}
