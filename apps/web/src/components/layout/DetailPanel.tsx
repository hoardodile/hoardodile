import { Button } from "@hoardodile/ui/components/button"
import { MobileDrawer } from "@hoardodile/ui/components/mobile-drawer"
import { SidebarMinimalistic } from "@hoardodile/ui/icons/registry"
import { type ReactNode, useState } from "react"
import { createPortal } from "react-dom"
import { useClaimPanelSlot } from "./panelSlot"

export type DetailPanelProps = {
	/** FAB aria-label ("Open sidebar", per page). */
	readonly fabLabel: string
	readonly fabTestId?: string
	/**
	 * Inline trigger rendered instead of the floating FAB — the page puts
	 * it in its header action row. Receives the open callback.
	 */
	readonly trigger?: (open: () => void) => ReactNode
	readonly children: ReactNode
}

/**
 * Detail-page right panel: the AppShell's panel column at and above the
 * panel breakpoint (claimed and portaled — the same slot the search
 * rails use), a right drawer below it. The drawer's trigger is either
 * the fixed FAB or an inline {@link DetailPanelTrigger} the page embeds
 * in its header. One children instance serves both surfaces.
 */
export function DetailPanel(props: DetailPanelProps) {
	const { fabLabel, fabTestId, trigger, children } = props
	const [open, setOpen] = useState(false)
	const slot = useClaimPanelSlot()

	return (
		<>
			{slot !== null ? createPortal(children, slot) : null}
			{trigger !== undefined ? (
				trigger(() => setOpen(true))
			) : (
				<Button
					type="button"
					variant="secondary"
					size="icon"
					className="fixed bottom-4 right-4 z-50 shadow-lg min-[1440px]:hidden"
					aria-label={fabLabel}
					onClick={() => setOpen(true)}
					data-testid={fabTestId}
				>
					<SidebarMinimalistic className="size-5" />
				</Button>
			)}
			<MobileDrawer
				open={open}
				onOpenChange={setOpen}
				side="right"
				width="w-panel"
				hideAbove="min-[1440px]:hidden"
				className="bg-background"
			>
				{children}
			</MobileDrawer>
		</>
	)
}

/**
 * The drawer trigger's inline form: a quiet icon button (same anatomy as
 * the header's More trigger) that hides once the panel column takes over
 * at the panel breakpoint. Render it through {@link DetailPanelProps.trigger}.
 */
export function DetailPanelTrigger(props: {
	readonly label: string
	readonly testId?: string
	readonly onOpen: () => void
}) {
	return (
		<button
			type="button"
			title={props.label}
			aria-label={props.label}
			className="flex size-8 items-center justify-center rounded-lg text-secondary-foreground hover:bg-muted min-[1440px]:hidden"
			data-testid={props.testId}
			onClick={props.onOpen}
		>
			<SidebarMinimalistic className="size-4" strokeWidth={1.6} />
		</button>
	)
}
