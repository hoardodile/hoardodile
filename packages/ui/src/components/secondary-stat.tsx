import { SectionLabel } from "./section-label"

/**
 * Secondary stat — the quiet supporting readout beside a KPI: uppercase
 * tracking-label label over a bold tabular numeral.
 */
export function SecondaryStat({
	label,
	value,
	className,
}: {
	readonly label: string
	readonly value: string
	readonly className?: string
}) {
	return (
		<div className={className}>
			<SectionLabel>{label}</SectionLabel>
			<div className="mt-1 text-xl font-bold tabular-nums text-foreground">
				{value}
			</div>
		</div>
	)
}
