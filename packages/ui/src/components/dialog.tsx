import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@hoardodile/ui/lib/utils"
import { Button } from "@hoardodile/ui/components/button"
import { useMobileBackToClose } from "@hoardodile/ui/hooks/useMobileBackToClose"
import { Cross } from "@hoardodile/ui/icons/marks"

function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: Omit<DialogPrimitive.Root.Props, "onOpenChange"> & {
  /**
   * `eventDetails` is absent for closes triggered by the mobile back
   * gesture (a synthetic close with no underlying Base UI event).
   */
  onOpenChange?: (
    open: boolean,
    eventDetails?: DialogPrimitive.Root.ChangeEventDetails,
  ) => void
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    defaultOpen ?? false,
  )
  const isControlled = open !== undefined
  const currentOpen = isControlled ? open : uncontrolledOpen
  function handleOpenChange(
    next: boolean,
    eventDetails?: DialogPrimitive.Root.ChangeEventDetails,
  ) {
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next, eventDetails)
  }
  useMobileBackToClose(currentOpen, handleOpenChange)
  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      open={currentOpen}
      onOpenChange={handleOpenChange}
      {...props}
    />
  )
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        // The dialog layer: a static whisper-of-ink scrim plus
        // backdrop blur — part of the surface definition, not motion.
        "fixed inset-0 isolate z-50 bg-foreground/5 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-sm",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  overlayClassName,
  contentMotion = "default",
  ...props
}: DialogPrimitive.Popup.Props &
  React.RefAttributes<HTMLDivElement> & {
    showCloseButton?: boolean
    /** Merged into {@link DialogOverlay}. Use to drop backdrop blur over heavy GPU layers (e.g. WebGL). */
    overlayClassName?: string
    /**
     * `minimal` uses fade-only enter/exit (no slide/zoom) to reduce jank
     * when opening over canvas/video or other expensive surfaces.
     */
    contentMotion?: "default" | "minimal"
  }) {
  // Auto-wrap "loose" body children (anything that is not a DialogHeader
  // or DialogFooter) inside a DialogBody. This guarantees a single
  // scroll container — historically callers relied on DialogContent
  // itself scrolling and added their own nested `overflow-y-auto`
  // wrappers, which produced a confusing two-scrollbar behaviour on
  // touch devices. With a single inner scroller, header/footer stay
  // pinned and only the middle region scrolls on every viewport.
  const arranged = arrangeDialogChildren(children)
  const motionClasses =
    contentMotion === "minimal"
      ? "data-ending-style:opacity-0 data-starting-style:opacity-0"
      : cn(
          "data-ending-style:translate-y-10 data-ending-style:opacity-0 data-starting-style:translate-y-10 data-starting-style:opacity-0",
          // ≥ sm the popup is centred with -translate-y-1/2, so the
          // starting/ending styles must keep that offset (zoom + fade
          // only, no slide) instead of clobbering it with translate-y-0.
          "sm:data-ending-style:-translate-y-1/2 sm:data-ending-style:scale-95 sm:data-starting-style:-translate-y-1/2 sm:data-starting-style:scale-95"
        )
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // The floating-card anatomy: `bg-card`
          // hairline-bordered surface with the system's one deep shadow.
          // Mobile: bottom sheet occupying most of the viewport so edit
          // forms have room to breathe. The component never scrolls
          // itself; only the inner DialogBody does. Header/body/footer
          // parts are held apart by the card's section gap
          // (`gap-4` between the header document, the body and the
          // hairline footer).
          "fixed z-50 flex flex-col gap-4 bg-card text-sm text-card-foreground shadow-dialog outline-hidden transition duration-200 ease-in-out",
          "inset-x-0 bottom-0 max-h-[85svh] overflow-hidden rounded-t-2xl rounded-b-none border border-b-0 border-border",
          motionClasses,
          // ≥ sm: centred modal, allow up to 90vh.
          "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-md sm:max-h-[90vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          className
        )}
        {...props}
      >
        {arranged}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-3 right-3 z-20 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          >
            <Cross className="size-3" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        // The header document: the card's `p-5`
        // rhythm — 20px top and sides, no bottom padding — with the
        // eyebrow, title row and description stacked tight; the section
        // gap below separates it from the body.
        "flex shrink-0 flex-col bg-card px-5 pt-5",
        className
      )}
      {...props}
    />
  )
}

/**
 * Scrolling body region for dialogs. The dialog itself never scrolls —
 * only this element does — so touch users always interact with one
 * obvious scroll surface. The card's `p-5` side rhythm lives here; the
 * section gaps (`gap-4`) separate it from the header and footer.
 */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        "flex-1 overflow-y-auto overscroll-contain px-5",
        className
      )}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  flush = false,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  flush?: boolean
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex shrink-0 flex-col bg-card", className)}
      {...props}
    >
      {/* Inset hairline: the same side padding as the content below, so
          the divider never runs edge to edge. */}
      <div
        className={cn(
          "border-t border-border",
          flush ? "mx-4" : "mx-5"
        )}
      />
      <div
        className={cn(
        // The hairline action bar: 16px above the
        // buttons, the card's bottom padding (20px) below.
          "flex flex-row justify-end flex-wrap gap-2",
          flush ? "p-4" : "px-5 pt-4 pb-5"
        )}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close render={<Button variant="outline" />}>
            Close
          </DialogPrimitive.Close>
        )}
      </div>
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-sm font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-xs leading-5 text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

/**
 * Splits dialog children into header/footer/body groups so loose body
 * nodes (passed by callers that pre-date `<DialogBody>`) get wrapped in
 * a single scrolling region. Children already wrapped in
 * `<DialogBody>` are passed through unchanged.
 */
function arrangeDialogChildren(children: React.ReactNode): React.ReactNode {
  const headers: React.ReactNode[] = []
  const footers: React.ReactNode[] = []
  const bodyNodes: React.ReactNode[] = []
  let hasExplicitBody = false
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) {
      bodyNodes.push(child)
      return
    }
    if (child.type === DialogHeader) {
      headers.push(child)
      return
    }
    if (child.type === DialogFooter) {
      footers.push(child)
      return
    }
    if (child.type === DialogBody) {
      hasExplicitBody = true
      bodyNodes.push(child)
      return
    }
    bodyNodes.push(child)
  })
  const body = hasExplicitBody ? (
    bodyNodes
  ) : (
    <DialogBody>{bodyNodes}</DialogBody>
  )
  return (
    <>
      {headers}
      {body}
      {footers}
    </>
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
