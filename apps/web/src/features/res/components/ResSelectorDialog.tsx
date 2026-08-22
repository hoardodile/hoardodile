import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ResSearch } from "./ResSearch"

// ── Single-select ────────────────────────────────────────────────────────────

export type ResSelectorSingleProps = {
	readonly open: boolean
	readonly mode: "single"
	readonly title?: string
	readonly excludeIds?: readonly string[]
	readonly onSelect: (id: string) => void
	readonly onOpenChange: (open: boolean) => void
	readonly confirmTestId?: string
}

// ── Multi-select ─────────────────────────────────────────────────────────────

export type ResSelectorMultiProps = {
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

export type ResSelectorDialogProps =
	| ResSelectorSingleProps
	| ResSelectorMultiProps

/**
 * Generic dialog wrapping {@link ResSearch} for selection. Use the
 * `single` mode for one-off picks (e.g. document inserts) and `multi`
 * for set editing. The dialog owns its own draft selection state and
 * commits via `onSelect` / `onConfirm` only on the user pressing Confirm.
 */
export function ResSelectorDialog(props: ResSelectorDialogProps) {
	if (props.mode === "single") return <SingleSelectorDialog {...props} />
	return <MultiSelectorDialog {...props} />
}

function SingleSelectorDialog(props: ResSelectorSingleProps) {
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
			title={title ?? t("resources.selectorDialog.title")}
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
						data-testid={confirmTestId ?? "resource-selector-confirm"}
					>
						{t("characters.selectorDialog.confirm")}
					</Button>
				</>
			}
		>
			<ResSearch
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

const EMPTY_IDS: readonly string[] = []

function MultiSelectorDialog(props: ResSelectorMultiProps) {
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
			title={title ?? t("resources.selectorDialog.title")}
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
						data-testid={confirmTestId ?? "resource-selector-confirm"}
					>
						{t("characters.selectorDialog.confirmCount", {
							count: selected.length,
						})}
					</Button>
				</>
			}
		>
			<ResSearch
				selection={{
					mode: "multi",
					selected,
					onChange: handleChange,
				}}
			/>
		</AppDialog>
	)
}
