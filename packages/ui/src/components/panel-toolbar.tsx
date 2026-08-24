import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Add } from "@hoardodile/ui/icons/actions"
import { HamburgerMenu } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { ChipButton } from "./chip-button"
import { SearchField } from "./search-field"

export type PanelToolbarProps = {
	readonly placeholder: string
	readonly query: string
	readonly onQuery: (query: string) => void
	readonly reorder: boolean
	readonly onToggleReorder: () => void
	readonly unusedCount: number
	readonly unusedOnly: boolean
	readonly onToggleUnused: () => void
	/** Add button — opens the shared create dialog. */
	readonly onAdd: () => void
	/** Add button label — defaults to the shared "Add" copy. */
	readonly addLabel?: string
	/** Unused chip label — defaults to the shared "Unused" copy. */
	readonly unusedLabel?: string
	/** Reorder chip label — defaults to the shared "Reorder" copy. */
	readonly reorderLabel?: string
	/** Forwarded to the filter field's `maxLength` (e.g. the query limit). */
	readonly maxLength?: number
	readonly testIds?: {
		readonly filter?: string
		readonly unused?: string
		readonly reorder?: string
		readonly add?: string
	}
}

/**
 * One toolbar per custom-page panel: filter left; triage, structure and
 * add right. Unused and Reorder ride ChipButton — the Unused filter wears
 * the dashed outline, Reorder quiet text, both latching the accent fill
 * when on. The Unused chip only appears when there is something to clean.
 */
export function PanelToolbar(props: PanelToolbarProps) {
	const {
		placeholder,
		query,
		onQuery,
		reorder,
		onToggleReorder,
		unusedCount,
		unusedOnly,
		onToggleUnused,
		onAdd,
		addLabel,
		unusedLabel,
		reorderLabel,
		maxLength,
		testIds,
	} = props
	const { t } = useTranslation("ui", { useSuspense: false })
	const resolvedAddLabel = addLabel ?? t("panelToolbar.add")
	const resolvedUnusedLabel = unusedLabel ?? t("panelToolbar.unused")
	const resolvedReorderLabel = reorderLabel ?? t("panelToolbar.reorder")
	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<SearchField
				value={query}
				onCommit={onQuery}
				placeholder={placeholder}
				maxLength={maxLength}
				className="w-60"
				testId={testIds?.filter}
			/>
			<div className="flex shrink-0 flex-wrap items-center gap-2">
				{unusedCount > 0 ? (
					<ChipButton
						dashed
						active={unusedOnly}
						onClick={onToggleUnused}
						testId={testIds?.unused}
					>
						{resolvedUnusedLabel} · {unusedCount}
					</ChipButton>
				) : null}
				<ChipButton
					icon={HamburgerMenu}
					active={reorder}
					onClick={onToggleReorder}
					testId={testIds?.reorder}
				>
					{resolvedReorderLabel}
				</ChipButton>
				<Button variant="secondary" onClick={onAdd} data-testid={testIds?.add}>
					<Icon icon={Add} />
					{resolvedAddLabel}
				</Button>
			</div>
		</div>
	)
}
