import { Sheet, SheetContent } from "@hoardodile/ui/components/sheet"
import { useBelowMd, useBelowSidebar } from "@hoardodile/ui/hooks/use-mobile"
import { cn } from "@hoardodile/ui/lib/utils"
import { useTranslation } from "react-i18next"
import type { WorkbenchResource } from "../context.ts"

/**
 * The workbench's resource picker, exposed as a left sidebar (mirroring the
 * pattern of the app's left nav). Two surface modes, like the reference
 * engine panel in `plugin-skeleton-animation`:
 * - **Docked**: a persistent left column beside the stage at the sidebar
 *   breakpoint and above (always shown — no toggle), styled after the
 *   app's left nav rows and scrollable.
 * - **Drawer**: slides in from the left (bottom on the very narrow `md`
 *   case) below the sidebar breakpoint, opened by the Resources toolbar
 *   button.
 * `open` only drives the drawer; the docked column needs no state. It sits
 * between the full-width top and bottom bars, never covering them.
 */
export function ResourceSidebar(props: {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly resources: readonly WorkbenchResource[]
	readonly selectedId: string | undefined
	readonly onSelect: (id: string) => void
}) {
	const { open, onOpenChange, resources, selectedId, onSelect } = props
	const { t: tw } = useTranslation("workbench")
	const below = useBelowSidebar()
	const narrow = useBelowMd()

	const body = (
		<div className="flex min-h-0 flex-1 flex-col px-3 pt-4.5 pb-2">
			<div className="strip-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
				{resources.length === 0 ? (
					<p className="px-2 py-3 text-xs text-muted-foreground">
						{tw("app.noResources")}
					</p>
				) : (
					<nav
						aria-label={tw("toolbar.resources")}
						className="flex flex-col gap-1"
					>
						{resources.map((r) => {
							const selected = r.id === selectedId
							return (
								<button
									key={r.id}
									type="button"
									data-testid="workbench-resource-item"
									data-resource-id={r.id}
									aria-current={selected ? "true" : undefined}
									onClick={() => {
										onSelect(r.id)
										onOpenChange(false)
									}}
									className={cn(
										"flex h-nav w-full items-center gap-3 rounded-lg px-3 text-ui font-medium",
										selected
											? "bg-muted text-foreground"
											: "text-secondary-foreground hover:bg-muted",
									)}
								>
									<span className="min-w-0 flex-1 truncate">{r.name}</span>
								</button>
							)
						})}
					</nav>
				)}
			</div>
		</div>
	)

	if (below) {
		return (
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					side={narrow ? "bottom" : "left"}
					showCloseButton={false}
					className="flex flex-col p-0 text-foreground max-md:h-[65vh] max-md:w-full max-md:max-w-none max-md:border-t max-md:border-l-0 bg-background"
				>
					{body}
				</SheetContent>
			</Sheet>
		)
	}

	// Docked: always shown at the sidebar breakpoint and above — no toggle.
	return (
		<aside
			data-testid="workbench-resource-sidebar"
			className="flex w-sidebar shrink-0 flex-col border-r border-border bg-background text-foreground"
		>
			{body}
		</aside>
	)
}
