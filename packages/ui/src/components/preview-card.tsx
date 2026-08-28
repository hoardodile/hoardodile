import * as React from "react"
import {
	PreviewCard as PreviewCardPrimitive,
} from "@base-ui/react/preview-card"

import { cn } from "@hoardodile/ui/lib/utils"

function PreviewCard({
	open,
	defaultOpen,
	onOpenChange,
	...props
}: Omit<PreviewCardPrimitive.Root.Props, "onOpenChange"> & {
	/** Base UI reports `eventDetails` for every change; keep the same shape
	    as the Popover wrapper so callers can filter by open reason. */
	onOpenChange?: (
		open: boolean,
		eventDetails: PreviewCardPrimitive.Root.ChangeEventDetails,
	) => void
}) {
	const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
		defaultOpen ?? false,
	)
	const isControlled = open !== undefined
	const currentOpen = isControlled ? open : uncontrolledOpen
	function handleOpenChange(
		next: boolean,
		eventDetails: PreviewCardPrimitive.Root.ChangeEventDetails,
	) {
		if (!isControlled) setUncontrolledOpen(next)
		onOpenChange?.(next, eventDetails)
	}
	return (
		<PreviewCardPrimitive.Root
			data-slot="preview-card"
			open={currentOpen}
			onOpenChange={handleOpenChange}
			{...props}
		/>
	)
}

function PreviewCardTrigger({ ...props }: PreviewCardPrimitive.Trigger.Props) {
	return (
		<PreviewCardPrimitive.Trigger
			data-slot="preview-card-trigger"
			{...props}
		/>
	)
}

function PreviewCardPositioner({
	className,
	align = "center",
	alignOffset = 0,
	side = "top",
	sideOffset = 8,
	...props
}: PreviewCardPrimitive.Positioner.Props) {
	return (
		<PreviewCardPrimitive.Positioner
			align={align}
			alignOffset={alignOffset}
			side={side}
			sideOffset={sideOffset}
			className={cn("isolate z-50", className)}
			{...props}
		/>
	)
}

function PreviewCardPopup({
	className,
	...props
}: PreviewCardPrimitive.Popup.Props) {
	return (
		<PreviewCardPrimitive.Popup
			data-slot="preview-card-content"
			className={cn(
				"z-50 origin-(--transform-origin) rounded-md bg-popover text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
				className,
			)}
			{...props}
		/>
	)
}

function PreviewCardPortal(
	props: React.ComponentProps<typeof PreviewCardPrimitive.Portal>,
) {
	return <PreviewCardPrimitive.Portal {...props} />
}

export {
	PreviewCard,
	PreviewCardPopup,
	PreviewCardPortal,
	PreviewCardPositioner,
	PreviewCardTrigger,
}
