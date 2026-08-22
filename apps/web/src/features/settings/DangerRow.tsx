import { Button } from "@hoardodile/ui/components/button"
import { Icon, type IconType } from "@hoardodile/ui/components/icon"

export type DangerRowProps = {
	readonly title: string
	readonly description: string
	readonly icon: IconType
	readonly actionLabel: string
	readonly pendingLabel: string
	readonly isPending: boolean
	readonly onAction: () => void
	readonly "data-testid"?: string
}

/**
 * Design — the Usage history rows (SettingsAppPage): title + muted
 * description on the left, a solid danger button on the right.
 */
export function DangerRow(props: DangerRowProps) {
	const {
		title,
		description,
		icon,
		actionLabel,
		pendingLabel,
		isPending,
		onAction,
		"data-testid": testId,
	} = props
	return (
		<div className="flex items-center justify-between gap-3">
			<div className="min-w-0">
				<div className="text-ui font-semibold text-foreground">{title}</div>
				<p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
			</div>
			<Button
				variant="danger"
				className="shrink-0"
				onClick={onAction}
				disabled={isPending}
				data-testid={testId}
			>
				<Icon icon={icon} />
				{isPending ? pendingLabel : actionLabel}
			</Button>
		</div>
	)
}
