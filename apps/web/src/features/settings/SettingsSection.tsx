import type { IconType } from "@hoardodile/ui/components/icon"
import { IconTile } from "@hoardodile/ui/components/icon-tile"
import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"

export type SettingsSectionProps = {
	readonly icon?: IconType
	readonly title: ReactNode
	readonly description?: string
	readonly layout?: "split" | "stack" | "compact"
	readonly children: ReactNode
	readonly className?: string
	readonly "data-testid"?: string
}

/**
 * Settings section — the unit every settings page is built from.
 *
 * One header anatomy across all three layouts — 32px icon tile + 16px
 * semibold title + one muted 12px line, tile and title inline. Only the
 * control placement differs: split (default) gives the header a quiet
 * 200px column, top-aligned with the controls beside it; stack puts the
 * header above wide content (chip clouds, timelines); compact pins one
 * control to the right of the header in a single vertically centered row.
 */
export function SettingsSection(props: SettingsSectionProps) {
	const {
		icon,
		title,
		description,
		layout = "split",
		children,
		className,
	} = props

	const header = (
		<div
			className={cn(
				"flex min-w-0 gap-3",
				layout === "compact" ? "items-center" : "items-start",
			)}
		>
			{icon !== undefined ? <IconTile icon={icon} /> : null}
			<div className="min-w-0">
				<div className="text-base font-semibold text-foreground">{title}</div>
				{description !== undefined ? (
					<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
						{description}
					</p>
				) : null}
			</div>{" "}
		</div>
	)

	if (layout === "compact") {
		return (
			// Single-line row on desktop; below the sidebar breakpoint the
			// control stacks under the header — never squeeze-then-wrap, so
			// the title/description keep their full width.
			<section
				className={cn(
					"flex flex-col items-start gap-2 sidebar:flex-row sidebar:items-center sidebar:gap-4",
					className,
				)}
				data-testid={props["data-testid"]}
			>
				<div className="w-full min-w-0 flex-1">{header}</div>
				<div className="shrink-0">{children}</div>
			</section>
		)
	}

	if (layout === "stack") {
		return (
			<section className={className} data-testid={props["data-testid"]}>
				{header}
				<div className="mt-5">{children}</div>
			</section>
		)
	}

	return (
		<section
			className={cn("grid grid-cols-[200px_1fr] gap-8", className)}
			data-testid={props["data-testid"]}
		>
			{header}
			<div className="min-w-0">{children}</div>
		</section>
	)
}
