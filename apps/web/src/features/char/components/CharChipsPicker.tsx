import { Button } from "@hoardodile/ui/components/button"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { Add } from "@hoardodile/ui/icons/actions"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CharChip } from "./CharChip"
import { CharSelectorDialog, useCharactersByIds } from "./CharSelectorDialog"

export type CharChipsPickerProps = {
	readonly ids: readonly string[]
	/** Edit handler. Omit for view-only mode (no `+` / `×` controls). */
	readonly onChange?: (ids: readonly string[]) => void
	/** Ids that the selector dialog must never offer (e.g. self). */
	readonly excludeIds?: readonly string[]
	/** Ids that cannot be removed via chip `×` or selector deselect. */
	readonly lockedIds?: readonly string[]
	readonly selectorTitle?: string
	readonly className?: string
	readonly testId?: string
}

/**
 * Chip row of characters. Bulk-fetches via `character.byIds` (one round
 * trip) and renders each id as a {@link CharChip}.
 *
 * In edit mode (`onChange` provided):
 * - Each chip exposes an `×` to drop that id.
 * - A trailing `+` button opens {@link CharSelectorDialog} in
 *   multi-select mode, pre-populated with the current ids.
 *
 * In view-only mode the chips are static.
 */
function mergeLockedIds(
	next: readonly string[],
	lockedIds: readonly string[] | undefined,
): readonly string[] {
	const locked = lockedIds ?? []
	if (locked.length === 0) return next
	const extras = next.filter((id) => !locked.includes(id))
	return [...locked, ...extras]
}

export function CharChipsPicker(props: CharChipsPickerProps) {
	const {
		ids,
		onChange,
		excludeIds,
		lockedIds,
		selectorTitle,
		className,
		testId,
	} = props
	const [pickerOpen, setPickerOpen] = useState(false)
	const charsQuery = useCharactersByIds(ids)
	const characters = charsQuery.data ?? []
	const { t } = useTranslation()

	function charFor(id: string) {
		return characters.find((c) => c.id === id)
	}

	function handleRemove(id: string) {
		if (onChange === undefined) return
		if (lockedIds?.includes(id)) return
		onChange(ids.filter((existing) => existing !== id))
	}

	function handleConfirm(next: readonly string[]) {
		if (onChange === undefined) return
		onChange(mergeLockedIds(next, lockedIds))
		setPickerOpen(false)
	}

	return (
		<div
			className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}
			data-testid={testId}
		>
			{charsQuery.isLoading && ids.length > 0 ? (
				<Skeleton className="h-7 w-24 rounded-full" />
			) : null}
			{ids.map((id) => {
				const isLocked = lockedIds?.includes(id) ?? false
				return (
					<CharChip
						key={id}
						charId={id}
						character={charFor(id)}
						onRemove={
							onChange === undefined || isLocked
								? undefined
								: () => handleRemove(id)
						}
						showName
						testId={testId !== undefined ? `${testId}-chip-${id}` : undefined}
					/>
				)
			})}
			{onChange !== undefined ? (
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={() => setPickerOpen(true)}
					aria-label={t("characters.chips.linkCharacters")}
					data-testid={
						testId !== undefined ? `${testId}-linkCharacters` : undefined
					}
				>
					<Add className="size-3.5" />
					{t("me.custom.link")}
				</Button>
			) : null}
			{onChange !== undefined ? (
				<CharSelectorDialog
					open={pickerOpen}
					mode="multi"
					title={selectorTitle}
					initialSelected={ids}
					excludeIds={excludeIds}
					lockedIds={lockedIds}
					onConfirm={handleConfirm}
					onOpenChange={setPickerOpen}
					confirmTestId={
						testId !== undefined ? `${testId}-selector-confirm` : undefined
					}
				/>
			) : null}
		</div>
	)
}
