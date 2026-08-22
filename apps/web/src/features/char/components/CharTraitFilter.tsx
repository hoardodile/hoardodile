import type {
	DateFilterValue,
	MonthDayFilterValue,
	TraitDef,
	TraitFilter,
	TraitKind,
} from "@hoardodile/schemas"
import { MAX_TRAIT_FILTER_VALUE_LENGTH } from "@hoardodile/schemas"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { GroupLabel } from "@hoardodile/ui/components/group-label"
import { Input } from "@hoardodile/ui/components/input"
import { QueryStateView } from "@hoardodile/ui/components/query-state-view"
import { Cross } from "@hoardodile/ui/icons/marks"
import { useQuery } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { AddGridPill } from "@/components/common/AddGridPill"
import { DualChipList } from "@/components/common/DualChipList"
import { TagChip } from "@/features/tags/TagChip"
import { traitListQueryOptions } from "@/features/traits"
import { TraitAddDialog } from "@/features/traits/TraitAddDialog"
import { TraitDateField } from "./TraitDateField"

type CharTraitFilterProps = Readonly<{
	value: readonly TraitFilter[]
	onChange(next: readonly TraitFilter[]): void
}>

type NumericOp = ">" | ">=" | "<" | "<=" | "="
type DateOp =
	| "dateAfter"
	| "dateOnOrAfter"
	| "dateBefore"
	| "dateOnOrBefore"
	| "dateOn"
	| "dateMonthDayOn"
	| "dateMonthDayToday"
type TextOp = "contains"
type NullaryOp = "empty" | "notempty"
type TraitFilterOp = NumericOp | DateOp | TextOp | NullaryOp

const NUMERIC_OPS: readonly NumericOp[] = [">=", "<=", "=", ">", "<"]
const DATE_OPS: readonly DateOp[] = [
	"dateOnOrAfter",
	"dateOnOrBefore",
	"dateOn",
	"dateMonthDayOn",
	"dateMonthDayToday",
	"dateAfter",
	"dateBefore",
]
const NULLARY_OPS: readonly NullaryOp[] = ["empty", "notempty"]
const TEXT_OPS: readonly TextOp[] = ["contains"]

const DEFAULT_DATE_FILTER_VALUE: DateFilterValue = {
	sign: "+",
	year: 2000,
	month: 1,
	day: 1,
}

const DEFAULT_MONTH_DAY_FILTER_VALUE: MonthDayFilterValue = {
	month: 1,
	day: 1,
}

function isNumericKind(kind: TraitKind): boolean {
	return kind === "number" || kind === "height" || kind === "weight"
}

function isDateKind(kind: TraitKind): boolean {
	return kind === "date"
}

function isNullaryOp(op: string): op is NullaryOp {
	return (NULLARY_OPS as readonly string[]).includes(op)
}

function isNumericOp(op: string): op is NumericOp {
	return (NUMERIC_OPS as readonly string[]).includes(op)
}

function isDateOp(op: string): op is DateOp {
	return (DATE_OPS as readonly string[]).includes(op)
}

function opsForKind(kind: TraitKind): readonly TraitFilterOp[] {
	if (isNumericKind(kind)) return [...NUMERIC_OPS, ...NULLARY_OPS]
	if (isDateKind(kind)) return [...DATE_OPS, ...NULLARY_OPS]
	return [...TEXT_OPS, ...NULLARY_OPS]
}

/** Build the default filter clause for a freshly selected trait. */
function defaultFilterForTrait(trait: TraitDef): TraitFilter {
	if (isNumericKind(trait.kind)) {
		return { traitId: trait.id, op: ">=", value: 0 }
	}
	if (isDateKind(trait.kind)) {
		return {
			traitId: trait.id,
			op: "dateOnOrAfter",
			value: { ...DEFAULT_DATE_FILTER_VALUE },
		}
	}
	return { traitId: trait.id, op: "contains", value: "" }
}

/** Replace just the operator on an existing filter, picking a sensible value. */
function withOpReplaced(traitId: string, op: string): TraitFilter | undefined {
	if (isNullaryOp(op)) return { traitId, op }
	if (op === "contains") return { traitId, op, value: "" }
	if (isNumericOp(op)) return { traitId, op, value: 0 }
	if (op === "dateMonthDayOn")
		return { traitId, op, value: { ...DEFAULT_MONTH_DAY_FILTER_VALUE } }
	if (op === "dateMonthDayToday") return { traitId, op }
	if (isDateOp(op))
		return { traitId, op, value: { ...DEFAULT_DATE_FILTER_VALUE } }
	return undefined
}

/**
 * Trait filters (the Traits facet): selected traits render as rows — the
 * trait's card chip, an operator selector, a value field and a remove
 * mark — over the Available chip cloud, where clicking a trait adds a
 * fresh clause. Clauses combine with AND in the backend (see
 * `matchesTraitFilters` in `character/service.ts`).
 */
export function CharTraitFilter(props: CharTraitFilterProps) {
	const { value, onChange } = props
	const { t } = useTranslation()
	const traitsQuery = useQuery(traitListQueryOptions())
	const [addOpen, setAddOpen] = useState(false)

	return (
		<>
			<QueryStateView
				result={traitsQuery}
				isEmpty={isEmptyTraitList}
				loading={
					<p className="text-xs text-muted-foreground">{t("common.loading")}</p>
				}
				empty={
					<p className="text-xs text-muted-foreground">
						{t("characters.traitFilter.empty")}
					</p>
				}
			>
				{(traits) => (
					<CharTraitFilterBody
						traits={traits}
						value={value}
						onChange={onChange}
					/>
				)}
			</QueryStateView>
			{/* Quick-add — the dashed pill creates a trait definition on the
			    spot, then it appears in the Available cloud. */}
			<AddGridPill
				label={t("me.custom.entity.trait")}
				onClick={() => setAddOpen(true)}
				className="mt-1.5"
				testId="trait-filter-add"
			/>
			<TraitAddDialog open={addOpen} onOpenChange={setAddOpen} />
		</>
	)
}

function isEmptyTraitList(traits: readonly TraitDef[]): boolean {
	return traits.length === 0
}

type CharTraitFilterBodyProps = Readonly<{
	traits: readonly TraitDef[]
	value: readonly TraitFilter[]
	onChange(next: readonly TraitFilter[]): void
}>

function CharTraitFilterBody(props: CharTraitFilterBodyProps) {
	const { traits, value, onChange } = props
	const { t } = useTranslation()

	const addedIds = new Set(value.map((filter) => filter.traitId))
	const available = traits.filter((trait) => !addedIds.has(trait.id))

	function handleAdd(traitId: string) {
		const trait = traits.find((tt) => tt.id === traitId)
		if (trait === undefined) return
		onChange([...value, defaultFilterForTrait(trait)])
	}

	function handleRemove(index: number) {
		onChange(value.filter((_, i) => i !== index))
	}

	function handleReplace(index: number, next: TraitFilter) {
		onChange(value.map((row, i) => (i === index ? next : row)))
	}

	return (
		<div data-testid="character-trait-filter">
			<DualChipList
				items={available.map((trait) => ({
					id: trait.id,
					label: trait.name,
					color: trait.color,
				}))}
				size="md"
				selectedRows={
					value.length > 0 ? (
						<div className="flex flex-col gap-1.5">
							<GroupLabel>{t("common.selected")}</GroupLabel>
							<div className="flex flex-col gap-2">
								{value.map((filter, index) => (
									<TraitFilterRow
										key={filter.traitId}
										traits={traits}
										filter={filter}
										onChange={(next) => handleReplace(index, next)}
										onRemove={() => handleRemove(index)}
									/>
								))}
							</div>
						</div>
					) : undefined
				}
				onToggle={handleAdd}
			/>
		</div>
	)
}

type TraitFilterRowProps = Readonly<{
	traits: readonly TraitDef[]
	filter: TraitFilter
	onChange(next: TraitFilter): void
	onRemove(): void
}>

function TraitFilterRow(props: TraitFilterRowProps) {
	const { traits, filter, onChange, onRemove } = props
	const { t } = useTranslation()
	const trait = traits.find((tt) => tt.id === filter.traitId) ?? traits[0]
	if (trait === undefined) return undefined
	const traitId = trait.id
	const ops = opsForKind(trait.kind)

	function handleOpChange(op: string) {
		const next = withOpReplaced(traitId, op)
		if (next !== undefined) onChange(next)
	}

	function renderValueInput(): ReactNode {
		switch (filter.op) {
			case "empty":
			case "notempty":
				return undefined
			case "contains":
				return (
					<TraitValueInput
						value={filter.value}
						maxLength={MAX_TRAIT_FILTER_VALUE_LENGTH}
						className="w-full flex-1"
						onChange={(v) => onChange({ traitId, op: "contains", value: v })}
					/>
				)
			case "dateAfter":
			case "dateOnOrAfter":
			case "dateBefore":
			case "dateOnOrBefore":
			case "dateOn":
				return (
					<TraitDateField
						value={filter.value}
						onChange={(next) =>
							onChange({ traitId, op: filter.op, value: next })
						}
					/>
				)
			case "dateMonthDayOn":
				return (
					<div className="flex items-center gap-1">
						<TraitValueInput
							type="number"
							value={filter.value.month}
							className="w-16"
							onChange={(v) => {
								const parsed = Number.parseInt(v, 10)
								onChange({
									traitId,
									op: "dateMonthDayOn",
									value: {
										...filter.value,
										month: Number.isFinite(parsed) ? parsed : 1,
									},
								})
							}}
						/>
						<span className="text-muted-foreground">/</span>
						<TraitValueInput
							type="number"
							value={filter.value.day}
							className="w-16"
							onChange={(v) => {
								const parsed = Number.parseInt(v, 10)
								onChange({
									traitId,
									op: "dateMonthDayOn",
									value: {
										...filter.value,
										day: Number.isFinite(parsed) ? parsed : 1,
									},
								})
							}}
						/>
					</div>
				)
			case "dateMonthDayToday":
				return (
					<span className="text-xs text-muted-foreground">
						{t("characters.traitFilter.opDateMonthDayToday")}
					</span>
				)
			case ">":
			case ">=":
			case "<":
			case "<=":
			case "=":
				return (
					<TraitValueInput
						type="number"
						value={filter.value}
						className="w-full flex-1"
						onChange={(v) => {
							const parsed = Number.parseFloat(v)
							onChange({
								traitId,
								op: filter.op,
								value: Number.isFinite(parsed) ? parsed : 0,
							})
						}}
					/>
				)
		}
	}

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<TagChip color={trait.color} size="md" className="shrink-0">
				{trait.name}
			</TagChip>
			<DropdownSelect
				value={filter.op}
				onValueChange={handleOpChange}
				triggerClassName="h-chip rounded-sm px-1.5 text-xs"
				options={ops.map((op) => ({
					value: op,
					label: labelForOp(op, t),
				}))}
			/>
			{renderValueInput()}
			<button
				type="button"
				onClick={onRemove}
				aria-label={t("common.removeAria")}
				className="shrink-0 cursor-pointer text-muted-foreground hover:text-secondary-foreground"
				data-testid="character-trait-filter-remove"
			>
				<Cross className="size-4" />
			</button>
		</div>
	)
}

/** The rail's compact value field — the shared Input at the chip height. */
function TraitValueInput(props: {
	readonly value: string | number
	readonly onChange: (value: string) => void
	readonly type?: "text" | "number"
	readonly maxLength?: number
	readonly className?: string
}) {
	return (
		<Input
			type={props.type ?? "text"}
			value={props.value}
			onChange={(e) => props.onChange(e.target.value)}
			maxLength={props.maxLength}
			size="sm"
			className={`min-w-0 ${props.className ?? ""}`}
		/>
	)
}

function labelForOp(op: TraitFilterOp, t: (key: string) => string): string {
	switch (op) {
		case "contains":
			return t("characters.traitFilter.opContains")
		case "empty":
			return t("characters.traitFilter.opEmpty")
		case "notempty":
			return t("characters.traitFilter.opNotEmpty")
		case "dateAfter":
			return t("characters.traitFilter.opDateAfter")
		case "dateOnOrAfter":
			return t("characters.traitFilter.opDateOnOrAfter")
		case "dateBefore":
			return t("characters.traitFilter.opDateBefore")
		case "dateOnOrBefore":
			return t("characters.traitFilter.opDateOnOrBefore")
		case "dateOn":
			return t("characters.traitFilter.opDateOn")
		case "dateMonthDayOn":
			return t("characters.traitFilter.opDateMonthDayOn")
		case "dateMonthDayToday":
			return t("characters.traitFilter.opDateMonthDayToday")
		case ">":
		case "<":
		case ">=":
		case "<=":
		case "=":
			return op
	}
}
