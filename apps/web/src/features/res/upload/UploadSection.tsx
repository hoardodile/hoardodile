import { cn } from "@hoardodile/ui/lib/utils"
import type { ComponentType, ReactNode } from "react"

export type UploadSectionProps = {
	readonly icon?: ComponentType<{ className?: string }>
	readonly title: string
	readonly description?: string
	/** Right-aligned muted meta on the section header (e.g. "6 files · 18 MB"). */
	readonly aside?: string
	readonly children: ReactNode
	readonly className?: string
	readonly action?: ReactNode
	readonly "data-testid"?: string
}

/**
 * Upload form section — icon tile + title + muted description above a
 * floating card body. The header row lives outside the card; only the
 * content sits inside the `px-6 py-5` card, so the section reads as label
 * over a bordered surface.
 */
export function UploadSection(props: UploadSectionProps) {
	const Icon = props.icon
	return (
		<section
			className={cn("flex flex-col", props.className)}
			data-testid={props["data-testid"]}
		>
			<div className="flex items-center gap-3">
				{Icon !== undefined ? (
					<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-secondary-foreground">
						<Icon className="size-4" />
					</span>
				) : null}
				<div className="min-w-0">
					<h2 className="text-sm font-semibold text-foreground">
						{props.title}
					</h2>
					{props.description !== undefined ? (
						<p className="mt-0.5 text-xs text-muted-foreground">
							{props.description}
						</p>
					) : null}
				</div>
				{props.aside !== undefined || props.action !== undefined ? (
					<div className="ml-auto flex shrink-0 items-center gap-3">
						{props.aside !== undefined ? (
							<span className="text-xs text-muted-foreground">
								{props.aside}
							</span>
						) : null}
						{props.action !== undefined ? (
							<div className="shrink-0">{props.action}</div>
						) : null}
					</div>
				) : null}
			</div>
			<div className="mt-3 rounded-xl border border-border bg-card px-6 py-5 shadow-card">
				{props.children}
			</div>
		</section>
	)
}
