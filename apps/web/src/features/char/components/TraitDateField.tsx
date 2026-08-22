import type { DateFilterValue } from "@hoardodile/schemas"
import { Input } from "@hoardodile/ui/components/input"
import { PillTabs } from "@hoardodile/ui/components/pill-tabs"
import { useTranslation } from "react-i18next"

export type TraitDateFieldProps = {
	readonly value: DateFilterValue
	readonly onChange: (value: DateFilterValue) => void
	readonly className?: string
}

function parsePositiveInt(input: string): number | undefined {
	const trimmed = input.trim()
	if (trimmed.length === 0) return undefined
	const parsed = Number.parseInt(trimmed, 10)
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined
	return parsed
}

/**
 * Compact date editor for trait filters. Shows BCE/CE toggle plus year/month/day
 * inputs and emits a structured {@link DateFilterValue}.
 */
export function TraitDateField(props: TraitDateFieldProps) {
	const { value, onChange, className } = props
	const { t } = useTranslation()

	function update(next: Partial<DateFilterValue>) {
		onChange({ ...value, ...next })
	}

	return (
		<div className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}>
			<PillTabs
				value={value.sign}
				onChange={(next) => {
					if (next === "+" || next === "-") update({ sign: next })
				}}
				className="shrink-0"
				items={[
					{
						value: "+",
						label: t("traits.values.date.after"),
						ariaLabel: "after",
					},
					{
						value: "-",
						label: t("traits.values.date.before"),
						ariaLabel: "before",
					},
				]}
			/>
			<Input
				type="number"
				value={value.year}
				onChange={(e) => {
					const parsed = parsePositiveInt(e.target.value)
					if (parsed !== undefined) update({ year: parsed })
				}}
				size="sm"
				className="w-20"
				placeholder={t("traits.values.date.year")}
			/>
			<span className="shrink-0 text-sm text-muted-foreground">-</span>
			<Input
				type="number"
				value={value.month}
				onChange={(e) => {
					const parsed = parsePositiveInt(e.target.value)
					if (parsed !== undefined) update({ month: parsed })
				}}
				size="sm"
				className="w-16"
				placeholder={t("traits.values.date.month")}
			/>
			<span className="shrink-0 text-sm text-muted-foreground">-</span>
			<Input
				type="number"
				value={value.day}
				onChange={(e) => {
					const parsed = parsePositiveInt(e.target.value)
					if (parsed !== undefined) update({ day: parsed })
				}}
				size="sm"
				className="w-16"
				placeholder={t("traits.values.date.day")}
			/>
		</div>
	)
}
