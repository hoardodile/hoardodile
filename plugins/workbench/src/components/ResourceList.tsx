import { cn } from "@hoardodile/ui/lib/utils"
import { useTranslation } from "react-i18next"
import type { WorkbenchResource } from "../context.ts"

/**
 * The wide-layout resource sidebar (the `sidebar:` breakpoint). A dense,
 * single-line list of the resources a plugin can be mounted against —
 * click a row to switch. Text-only (no cover thumbnails): DESIGN.md
 * density, and the cover render is the info dialog's job. Hidden below
 * the sidebar breakpoint, where the toolbar falls back to a chip list.
 */
export function ResourceList(props: {
	readonly resources: readonly WorkbenchResource[]
	readonly resource: WorkbenchResource | undefined
	readonly onSelect: (resId: string) => void
}) {
	const { resources, resource, onSelect } = props
	const { t: tw } = useTranslation("workbench")
	return (
		<aside
			data-testid="workbench-resource-list"
			className="hidden w-sidebar shrink-0 bg-background sidebar:flex"
		>
			<div className="flex min-h-0 flex-1 flex-col">
				<div className="flex h-nav shrink-0 items-center border-b border-border px-4">
					<span className="text-xs font-medium tracking-label text-muted-foreground uppercase">
						{tw("toolbar.resources")}
					</span>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					{resources.length === 0 ? (
						<p className="px-2 py-3 text-xs text-muted-foreground">
							{tw("app.noResources")}
						</p>
					) : (
						<nav
							className="flex flex-col gap-0.5"
							aria-label={tw("toolbar.resources")}
						>
							{resources.map((r) => {
								const selected = r.id === resource?.id
								return (
									<button
										key={r.id}
										type="button"
										data-testid="workbench-resource-item"
										data-resource-id={r.id}
										aria-current={selected ? "true" : undefined}
										onClick={() => onSelect(r.id)}
										className={cn(
											"flex h-nav w-full items-center gap-3 rounded-lg px-3 text-ui text-left",
											selected
												? "bg-muted font-medium text-foreground"
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
		</aside>
	)
}
