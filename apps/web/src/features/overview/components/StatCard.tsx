import { Surface } from "@hoardodile/ui/components/surface"
import { cn } from "@hoardodile/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import type { ComponentType } from "react"

type StatCardProps = {
	readonly to: "/resources" | "/characters" | "/documents" | "/messages"
	readonly icon?: ComponentType<{ className?: string }>
	readonly count: number
	readonly label: string
	readonly testId?: string
	readonly variant?: "default" | "flat" | "plain"
	readonly size?: "default" | "sm"
	readonly hideIcon?: boolean
}

export function StatCard(props: StatCardProps) {
	const Icon = props.icon
	const variant = props.variant ?? "default"
	const size = props.size ?? "default"
	const showIcon = variant !== "plain" && !props.hideIcon && Icon !== undefined

	if (variant === "plain") {
		return (
			<Link
				to={props.to}
				className="group flex flex-col gap-1"
				data-testid={props.testId}
			>
				<span className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground transition-colors group-hover:text-secondary-foreground">
					{props.label}
				</span>
				<span className="text-xl font-bold">{props.count}</span>
			</Link>
		)
	}

	const body = (
		<>
			{showIcon ? (
				<div
					className={cn(
						"flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary",
						size === "sm" ? "size-6" : "size-10",
					)}
				>
					<Icon className={size === "sm" ? "size-3.5" : "size-5"} />
				</div>
			) : null}
			<div className="flex min-w-0 items-baseline gap-1">
				<span
					className={cn(
						"font-semibold leading-none tabular-nums",
						size === "sm" ? "text-sm" : "text-2xl",
					)}
					data-testid={props.testId}
				>
					{props.count}
				</span>
				<span
					className={cn(
						"text-muted-foreground",
						size === "sm" ? "text-xs" : "text-xs",
					)}
				>
					{props.label}
				</span>
			</div>
		</>
	)

	if (variant === "flat") {
		return (
			<Link
				to={props.to}
				className={cn(
					"group flex items-center rounded-lg transition-colors hover:bg-accent/50",
					size === "sm" ? "gap-1.5 px-2 py-1" : "gap-3 p-2",
				)}
			>
				{body}
			</Link>
		)
	}

	return (
		<Link to={props.to} className="block">
			<Surface
				size="compact"
				className={cn(
					"group flex items-center transition-colors hover:bg-accent/50",
					size === "sm" ? "gap-1.5" : "gap-3",
				)}
			>
				{body}
			</Surface>
		</Link>
	)
}
