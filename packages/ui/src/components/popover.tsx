import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@hoardodile/ui/lib/utils"
import { useMobileBackToClose } from "@hoardodile/ui/hooks/useMobileBackToClose"

function Popover({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: Omit<PopoverPrimitive.Root.Props, "onOpenChange"> & {
  /**
   * `eventDetails` is absent for closes triggered by the mobile back
   * gesture (a synthetic close with no underlying Base UI event).
   */
  onOpenChange?: (
    open: boolean,
    eventDetails?: PopoverPrimitive.Root.ChangeEventDetails,
  ) => void
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    defaultOpen ?? false,
  )
  const isControlled = open !== undefined
  const currentOpen = isControlled ? open : uncontrolledOpen
  function handleOpenChange(
    next: boolean,
    eventDetails?: PopoverPrimitive.Root.ChangeEventDetails,
  ) {
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next, eventDetails)
  }
  useMobileBackToClose(currentOpen, handleOpenChange)
  return (
    <PopoverPrimitive.Root
      data-slot="popover"
      open={currentOpen}
      onOpenChange={handleOpenChange}
      {...props}
    />
  )
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  container,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    /**
     * Override the portal target. Used by the video player so popovers
     * stay attached to the fullscreen container; otherwise they'd be
     * portalled to `document.body` and rendered behind the fullscreen
     * surface, where every tap registers as outside-click and dismisses
     * the popover immediately.
     */
    container?: PopoverPrimitive.Portal.Props["container"]
  }) {
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-50 flex w-72 origin-(--transform-origin) flex-col gap-4 rounded-md bg-popover p-4 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
