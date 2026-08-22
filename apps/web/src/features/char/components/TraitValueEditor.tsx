import type { TraitDef } from "@hoardodile/schemas"
import { Button } from "@hoardodile/ui/components/button"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@hoardodile/ui/components/tooltip"
import { Check, Cross } from "@hoardodile/ui/icons/marks"
import { Help } from "@hoardodile/ui/icons/registry"
import { keyBy } from "es-toolkit"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { AddGridPill } from "@/components/common/AddGridPill"
import { TagChip } from "@/features/tags/TagChip"
import { TagChipLink } from "@/features/tags/TagChipLink"
import { TraitAddDialog } from "@/features/traits/TraitAddDialog"
import { TraitValueField } from "./TraitValueField"

export type TraitValueEditorProps = {
	readonly traits: readonly TraitDef[]
	readonly values: Record<string, string>
	readonly onChange: (values: Record<string, string>) => void
	readonly testIdPrefix?: string
}

/**
 * Pure UI trait value editor. Supports all trait kinds (text, multitext,
 * number, height, weight, date) with add/remove and a compact chip picker for
 * unset traits. The caller owns the values state.
 *
 * Each filled trait is rendered as a soft, compact row so the mixed field
 * layouts stay scannable without stacking borders.
 */
export function TraitValueEditor(props: TraitValueEditorProps) {
	const { traits, values, onChange, testIdPrefix } = props
	const { t } = useTranslation()
	const [addDefinitionOpen, setAddDefinitionOpen] = useState(false)

	const traitsById = keyBy(traits, (td) => td.id)
	const setTraitIds = Object.keys(values).filter(
		(id) => traitsById[id] !== undefined,
	)
	const unsetTraits = traits.filter((td) => values[td.id] === undefined)

	function handleChange(traitId: string, value: string) {
		onChange({ ...values, [traitId]: value })
	}

	function handleRemove(traitId: string) {
		const next = { ...values }
		delete next[traitId]
		onChange(next)
	}

	function handleAddPick(traitId: string) {
		onChange({ ...values, [traitId]: "" })
	}

	return (
		<div className="flex flex-col gap-3">
			<AddTraitControl
				traits={traits}
				unsetTraits={unsetTraits}
				onPick={handleAddPick}
				testIdPrefix={testIdPrefix}
			/>
			{/* Quick-add — the dashed pill creates a trait definition on the
			    spot, which then appears in the picker above. */}
			<AddGridPill
				label={t("me.custom.entity.trait")}
				onClick={() => setAddDefinitionOpen(true)}
				testId="trait-editor-add"
			/>
			<TraitAddDialog
				open={addDefinitionOpen}
				onOpenChange={setAddDefinitionOpen}
			/>

			{setTraitIds.length > 0 ? (
				<ul className="flex flex-col">
					{setTraitIds.map((id) => {
						const td = traitsById[id]
						if (td === undefined) return undefined
						return (
							<li
								key={id}
								className="animate-in fade-in slide-in-from-top-1 duration-200"
							>
								<div
									className="group flex flex-wrap items-center gap-2 p-2 transition-colors hover:bg-muted/50 has-focus-visible:bg-muted/40"
									data-testid={
										testIdPrefix ? `${testIdPrefix}-row-${id}` : undefined
									}
								>
									<TagChipLink
										id={id}
										type="character"
										name={td.name}
										suffix={t(`traits.kind.${td.kind}`)}
										color={td.color ?? ""}
										link={false}
										className="shrink-0"
									/>
									<TraitValueField
										kind={td.kind}
										value={values[id] ?? ""}
										onChange={(next) => handleChange(id, next)}
										testId={
											testIdPrefix ? `${testIdPrefix}-input-${id}` : undefined
										}
										placeholder={
											td.intro || t("traits.values.inputPlaceholder")
										}
									/>
									<Tooltip>
										<TooltipTrigger
											render={
												<Button
													type="button"
													variant="ghost"
													size="icon-xs"
													onClick={() => handleRemove(id)}
													aria-label={t("traits.values.remove")}
													data-testid={
														testIdPrefix
															? `${testIdPrefix}-remove-${id}`
															: undefined
													}
													className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
												>
													<Cross className="size-3.5" />
												</Button>
											}
										/>
										<TooltipContent>{t("traits.values.remove")}</TooltipContent>
									</Tooltip>
								</div>
							</li>
						)
					})}
				</ul>
			) : null}
		</div>
	)
}

type AddTraitControlProps = {
	readonly traits: readonly TraitDef[]
	readonly unsetTraits: readonly TraitDef[]
	readonly onPick: (traitId: string) => void
	readonly testIdPrefix?: string
}

function AddTraitControl(props: AddTraitControlProps) {
	const { traits, unsetTraits, onPick, testIdPrefix } = props
	const { t } = useTranslation()

	if (traits.length === 0) {
		return (
			<div
				className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground"
				data-testid={testIdPrefix ? `${testIdPrefix}-add-picker` : undefined}
			>
				<Help className="size-4" />
				{t("traits.values.noDefinitions")}
			</div>
		)
	}

	if (unsetTraits.length === 0) {
		return (
			<div
				className="flex items-center gap-2 text-sm text-muted-foreground"
				data-testid={testIdPrefix ? `${testIdPrefix}-add-picker` : undefined}
			>
				<Check className="size-4 text-primary" />
				{t("traits.values.allSet")}
			</div>
		)
	}

	return (
		<TraitPickerRow
			options={unsetTraits}
			onPick={onPick}
			testIdPrefix={testIdPrefix}
		/>
	)
}

type TraitPickerRowProps = {
	readonly options: readonly TraitDef[]
	readonly onPick: (traitId: string) => void
	readonly testIdPrefix?: string
}

function TraitPickerRow(props: TraitPickerRowProps) {
	const { options, onPick, testIdPrefix } = props
	const { t } = useTranslation()
	return (
		<div
			className="flex flex-wrap gap-1.5"
			data-testid={testIdPrefix ? `${testIdPrefix}-add-picker` : undefined}
		>
			{options.map((td) => (
				<TagChip
					key={td.id}
					color={td.color}
					size="md"
					onClick={() => onPick(td.id)}
					suffix={t(`traits.kind.${td.kind}`)}
					data-testid={
						testIdPrefix ? `${testIdPrefix}-add-pick-${td.id}` : undefined
					}
				>
					{td.name}
				</TagChip>
			))}
		</div>
	)
}
