import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"

type FixedActionBarProps = {
	readonly children: ReactNode
	readonly className?: string
	/**
	 * 0–100 shows the 2px top progress strip while an upload is staging;
	 * omit when idle. The track doubles as the seam.
	 */
	readonly progress?: number
}

/**
 * Fixed bottom action bar for long forms. Pinned to the viewport bottom
 * so the submit control is always reachable, starting after the sidebar
 * on md+; the top progress strip separates it from scrolling content (a
 * quiet muted track when idle, a foreground fill while staging). The
 * inner row mirrors PageScaffold's gutters and centers at `max-w-content`,
 * so the buttons right-align with the page column's edge. Forms using it
 * reserve clearance with bottom padding.
 */
export function FixedActionBar(props: FixedActionBarProps) {
	return (
		<div
			className={cn(
				"fixed inset-x-0 bottom-0 z-40 bg-background/90 backdrop-blur supports-backdrop-filter:bg-background/60 md:left-sidebar",
				props.className,
			)}
		>
			<div className="mx-auto w-full max-w-content">
				<div className="h-0.5 bg-muted">
					{props.progress !== undefined ? (
						<div
							className="h-full bg-foreground transition-[width] duration-(--duration-2) ease-standard"
							style={{ width: `${props.progress}%` }}
						/>
					) : null}
				</div>
			</div>
			<div className="mx-auto flex w-full max-w-content items-center justify-end gap-2 px-3 py-4 sm:px-6 lg:px-10">
				{props.children}
			</div>
		</div>
	)
}
