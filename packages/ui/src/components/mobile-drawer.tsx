import { useMobileBackToClose } from "@hoardodile/ui/hooks/useMobileBackToClose"
import { Cross } from "@hoardodile/ui/icons/marks"
import { cn } from "@hoardodile/ui/lib/utils"
import { type ReactNode, useEffect, useState } from "react"

export type MobileDrawerProps = {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly side?: "left" | "right"
	readonly width?: string
	/**
	 * Viewport variant at and above which the drawer is hidden. Must be a
	 * literal class at the call site (e.g. "min-[1440px]:hidden") so
	 * Tailwind can scan it. Defaults to "md:hidden".
	 */
	readonly hideAbove?: string
	readonly title?: ReactNode
	readonly children: ReactNode
	readonly className?: string
}

/**
 * Mobile-only slide-in drawer with backdrop, close header and
 * {@link useMobileBackToClose} integration.
 *
 * Renders nothing at and above the {@link MobileDrawerProps.hideAbove}
 * breakpoint ("md" by default) — the caller is expected to provide its
 * own desktop layout independently.
 */
export function MobileDrawer(props: MobileDrawerProps) {
	const {
		open,
		onOpenChange,
		side = "left",
		width = "w-72",
		hideAbove = "md:hidden",
		title,
	} = props
	const isLeft = side === "left"
	// Mount children only once the drawer has been opened, so closed drawers
	// (which stay in the tree for the slide transition) do not pay for
	// rendering their content. Once mounted they stay mounted so the close
	// animation and any inner state survive.
	const [hasOpened, setHasOpened] = useState(open)

	useEffect(() => {
		if (open) setHasOpened(true)
	}, [open])

	useMobileBackToClose(open, onOpenChange)

	return (
		<>
			{open && (
				<button
					type="button"
					className={cn(
						"fixed inset-0 z-30 bg-background/60 backdrop-blur-sm",
						hideAbove,
					)}
					onClick={() => onOpenChange(false)}
				/>
			)}
			<aside
				className={cn(
					"fixed top-0 z-40 flex h-svh flex-col bg-card transition-transform duration-200",
					hideAbove,
					isLeft ? "left-0 border-r" : "right-0 border-l",
					width,
					isLeft
						? open
							? "translate-x-0 shadow-xl"
							: "-translate-x-full"
						: open
							? "translate-x-0 shadow-xl"
							: "translate-x-full",
					props.className,
				)}
			>
				{title !== undefined && (
					<div className="flex items-center justify-between border-b px-3 py-3">
						<span className="text-sm font-medium">{title}</span>
						<button
							type="button"
							className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
							onClick={() => onOpenChange(false)}
						>
							<Cross className="size-4" />
						</button>
					</div>
				)}
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					{hasOpened ? props.children : null}
				</div>
			</aside>
		</>
	)
}
