import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { charByIdsQueryOptions } from "../api"
import { CharSearch } from "./CharSearch"

// ── Single-select ────────────────────────────────────────────────────────────

export type CharSelectorSingleProps = {
	readonly open: boolean
	readonly mode: "single"
	readonly title?: string
	/** Ids that the user must NOT pick (e.g. opposite side of a relation). */
	readonly excludeIds?: readonly string[]
	readonly onSelect: (id: string) => void
	readonly onOpenChange: (open: boolean) => void
	readonly confirmTestId?: string
}

// ── Multi-select ─────────────────────────────────────────────────────────────

export type CharSelectorMultiProps = {
	readonly open: boolean
	readonly mode: "multi"
	readonly title?: string
	readonly initialSelected?: readonly string[]
	readonly excludeIds?: readonly string[]
	/** Ids that stay selected and cannot be deselected in the dialog. */
	readonly lockedIds?: readonly string[]
	readonly onConfirm: (ids: readonly string[]) => void
	readonly onOpenChange: (open: boolean) => void
	readonly confirmTestId?: string
}

export type CharSelectorDialogProps =
	| CharSelectorSingleProps
	| CharSelectorMultiProps

/**
 * Generic dialog wrapping {@link CharSearch} for selection. Use the
 * `single` mode for one-off picks (e.g. relation endpoints) and `multi`
 * for set editing. The dialog owns its own draft selection state and
 * commits via `onSelect` / `onConfirm` only on the user pressing Confirm.
 */
export function CharSelectorDialog(props: CharSelectorDialogProps) {
	if (props.mode === "single") return <SingleSelectorDialog {...props} />
	return <MultiSelectorDialog {...props} />
}

function SingleSelectorDialog(props: CharSelectorSingleProps) {
	const { open, title, excludeIds, onSelect, onOpenChange, confirmTestId } =
		props
	const { t } = useTranslation()
	const [selected, setSelected] = useState<string | undefined>(undefined)

	const isExcluded =
		selected !== undefined && (excludeIds?.includes(selected) ?? false)
	const isSelectable = selected !== undefined && !isExcluded

	function handleOpenChange(next: boolean) {
		if (!next) {
			setSelected(undefined)
			onOpenChange(false)
		}
	}

	function handleConfirm() {
		if (isSelectable && selected !== undefined) {
			onSelect(selected)
			setSelected(undefined)
		}
	}

	return (
		<AppDialog
			open={open}
			onOpenChange={handleOpenChange}
			contentClassName="sm:max-w-3xl lg:max-w-4xl"
			title={title ?? t("characters.selectorDialog.title")}
			footer={
				<>
					<Button
						type="button"
						variant="secondary"
						onClick={() => handleOpenChange(false)}
					>
						{t("common.cancel")}
					</Button>
					<Button
						type="button"
						disabled={!isSelectable}
						onClick={handleConfirm}
						data-testid={confirmTestId}
					>
						{t("characters.selectorDialog.confirm")}
					</Button>
				</>
			}
		>
			<CharSearch
				selection={{
					mode: "single",
					selected,
					onChange: (id) =>
						setSelected(excludeIds?.includes(id) ? undefined : id),
				}}
			/>
			{isExcluded ? (
				<p className="text-xs text-destructive">
					{t("characters.selectorDialog.notSelectable")}
				</p>
			) : null}
		</AppDialog>
	)
}

function MultiSelectorDialog(props: CharSelectorMultiProps) {
	const {
		open,
		title,
		initialSelected,
		excludeIds,
		lockedIds,
		onConfirm,
		onOpenChange,
		confirmTestId,
	} = props
	const { t } = useTranslation()
	const initialIds = initialSelected ?? EMPTY_IDS
	const [selected, setSelected] = useState<readonly string[]>(initialIds)
	const [openKey, setOpenKey] = useState<readonly string[]>(initialIds)

	// Resync drafts when the dialog re-opens with a fresh `initialSelected`.
	if (open && openKey !== initialIds) {
		setOpenKey(initialIds)
		setSelected(initialIds)
	}

	function handleOpenChange(next: boolean) {
		if (!next) onOpenChange(false)
	}

	function handleChange(ids: readonly string[]) {
		const filtered =
			excludeIds === undefined
				? ids
				: ids.filter((id) => !excludeIds.includes(id))
		const locked = lockedIds ?? []
		const extras = filtered.filter((id) => !locked.includes(id))
		setSelected([...locked, ...extras])
	}

	return (
		<AppDialog
			open={open}
			onOpenChange={handleOpenChange}
			contentClassName="sm:max-w-3xl lg:max-w-4xl"
			title={title ?? t("characters.selectorDialog.title")}
			footer={
				<>
					<Button
						type="button"
						variant="secondary"
						onClick={() => onOpenChange(false)}
					>
						{t("common.cancel")}
					</Button>
					<Button
						type="button"
						onClick={() => onConfirm(selected)}
						data-testid={confirmTestId}
					>
						{t("characters.selectorDialog.confirmCount", {
							count: selected.length,
						})}
					</Button>
				</>
			}
		>
			<CharSearch
				selection={{
					mode: "multi",
					selected,
					onChange: handleChange,
				}}
			/>
		</AppDialog>
	)
}

const EMPTY_IDS: readonly string[] = []

/**
 * Convenience hook returning the `Character` records for a list of ids
 * via the batch `byIds` query. Exposed so chip-row consumers outside
 * {@link CharChipsPicker} can avoid N+1 detail fetches.
 */
export function useCharactersByIds(ids: readonly string[]) {
	return useQuery(charByIdsQueryOptions(ids))
}
