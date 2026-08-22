import type { ReactNode } from "react"

/**
 * Chart card — the stats page's standard chart surface: a floating card
 * with the chart's name and a muted trailing note, the chart below.
 */
export function ChartCard({
	title,
	subtitle,
	children,
	className,
}: {
	readonly title: string
	readonly subtitle: string
	readonly children: ReactNode
	readonly className?: string
}) {
	return (
		<div
			className={`rounded-xl border border-border bg-card p-5 shadow-card ${className ?? ""}`}
		>
			<div className="flex items-baseline justify-between gap-3">
				<span className="text-ui font-semibold text-foreground">{title}</span>
				<span className="shrink-0 text-tiny text-muted-foreground">
					{subtitle}
				</span>
			</div>
			<div className="mt-4">{children}</div>
		</div>
	)
}
