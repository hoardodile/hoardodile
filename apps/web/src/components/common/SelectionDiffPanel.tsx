import {
	DialogFooterActions,
	useDialogFooterActions,
} from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { toast } from "@hoardodile/ui/components/toast"
import {
	type QueryKey,
	type UseMutationOptions,
	type UseQueryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { errorMessage as resolveErrorMessage } from "@/lib/errors"

/**
 * Generic attach/detach selection-diff panel. Fetches the current
 * association set, lets the caller render any picker UI, then on save
 * dispatches the minimal diff of attach and detach mutations and
 * invalidates the relevant caches.
 */
export type SelectionDiffPanelProps<
	TItem,
	TInput,
	TAttachData = unknown,
	TDetachData = unknown,
	TQueryKey extends QueryKey = QueryKey,
> = {
	readonly query: UseQueryOptions<
		readonly TItem[],
		Error,
		readonly TItem[],
		TQueryKey
	>
	readonly getId: (item: TItem) => string
	readonly attach: UseMutationOptions<TAttachData, Error, TInput>
	readonly detach: UseMutationOptions<TDetachData, Error, TInput>
	readonly buildPayload: (id: string) => TInput
	readonly invalidate?: () => Promise<unknown> | undefined
	readonly successMessage?: string
	readonly errorMessage?: string
	readonly saveLabel?: string
	readonly savingLabel?: string
	readonly loadingLabel?: string
	readonly submitTestId?: string
	readonly bodyClassName?: string
	readonly onSaved?: () => void
	readonly children: (state: {
		readonly selected: readonly string[]
		readonly setSelected: (next: readonly string[]) => void
		readonly disabled: boolean
		readonly isLoading: boolean
	}) => ReactNode
}

export function SelectionDiffPanel<
	TItem,
	TInput,
	TAttachData = unknown,
	TDetachData = unknown,
	TQueryKey extends QueryKey = QueryKey,
>(
	props: SelectionDiffPanelProps<
		TItem,
		TInput,
		TAttachData,
		TDetachData,
		TQueryKey
	>,
) {
	const {
		query,
		getId,
		attach,
		detach,
		buildPayload,
		invalidate,
		successMessage,
		errorMessage,
		saveLabel,
		savingLabel,
		loadingLabel,
		submitTestId,
		bodyClassName = "max-h-[60vh] min-h-[30vh] overflow-y-auto pr-1",
		onSaved,
		children,
	} = props
	const { t } = useTranslation()
	const footerSlot = useDialogFooterActions()
	const resolvedSuccess = successMessage ?? t("common.saved")
	const resolvedError = errorMessage ?? t("common.saveFailed")
	const resolvedSave = saveLabel ?? t("common.save")
	const resolvedSaving = savingLabel ?? t("common.saving")
	const resolvedLoading = loadingLabel ?? t("common.loading")

	const itemsQuery = useQuery(query)
	const initialIds = useMemo<readonly string[]>(
		() => itemsQuery.data?.map(getId) ?? [],
		[itemsQuery.data, getId],
	)

	const [selected, setSelected] = useState<readonly string[]>(initialIds)
	useEffect(() => {
		setSelected(itemsQuery.data?.map(getId) ?? [])
	}, [itemsQuery.data, getId])

	const attachMut = useMutation(attach)
	const detachMut = useMutation(detach)
	const isPending = attachMut.isPending || detachMut.isPending

	async function handleSave() {
		const before = new Set(initialIds)
		const after = new Set(selected)
		const toAttach = selected.filter((id) => !before.has(id))
		const toDetach = initialIds.filter((id) => !after.has(id))
		try {
			await Promise.all([
				...toAttach.map((id) => attachMut.mutateAsync(buildPayload(id))),
				...toDetach.map((id) => detachMut.mutateAsync(buildPayload(id))),
			])
			if (invalidate !== undefined) await invalidate()
			toast.add({ title: resolvedSuccess, type: "success" })
			onSaved?.()
		} catch (err) {
			toast.add({
				title: resolveErrorMessage(err, resolvedError),
				type: "error",
			})
		}
	}

	const saveButton = (
		<Button
			type="button"
			onClick={handleSave}
			disabled={isPending || itemsQuery.isLoading}
			data-testid={submitTestId}
		>
			{isPending ? resolvedSaving : resolvedSave}
		</Button>
	)

	return (
		<div className="flex flex-col">
			<div className={bodyClassName}>
				{itemsQuery.isLoading ? (
					<p className="text-sm text-muted-foreground">{resolvedLoading}</p>
				) : (
					children({
						selected,
						setSelected,
						disabled: isPending,
						isLoading: itemsQuery.isLoading,
					})
				)}
			</div>
			{footerSlot !== null ? (
				<DialogFooterActions>{saveButton}</DialogFooterActions>
			) : (
				<div className="flex justify-end pt-2">{saveButton}</div>
			)}
		</div>
	)
}

export { useQueryClient }
