import type { ComponentType } from "react"

type ActivityRowIcon = ComponentType<{
	className?: string
	strokeWidth?: number
}>

/** List-row geometry shared by all recent-activity tabs.
    Hover takes the sidebar rows' muted fill. */
export const activityRowClassName =
	"flex h-12 items-center gap-3 border-b border-border last:border-b-0 transition-colors duration-150 hover:bg-muted"

type ActivityRowContentProps = {
	readonly icon: ActivityRowIcon
	readonly title: string
	readonly timeLabel: string
}

export function ActivityRowContent(props: ActivityRowContentProps) {
	const Icon = props.icon
	return (
		<>
			<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-secondary-foreground">
				<Icon className="size-4" strokeWidth={1.6} />
			</span>
			<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
				{props.title}
			</span>
			<span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
				{props.timeLabel}
			</span>
		</>
	)
}

export function ActivityRowSkeleton() {
	return (
		<div className={activityRowClassName}>
			<span className="size-8 shrink-0 rounded-lg bg-muted" />
			<span className="h-3 w-1/3 rounded bg-muted" />
		</div>
	)
}
