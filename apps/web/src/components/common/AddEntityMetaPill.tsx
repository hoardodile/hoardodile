import type { EntityMetaDraft } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Add } from "@hoardodile/ui/icons/actions"
import type { QueryClient, UseMutationOptions } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { TagChip } from "@/features/tags/TagChip"
import { useDelayedReset } from "@/hooks/useDelayedReset"
import { useSaveMutation } from "@/hooks/useSaveMutation"
import {
	buildEntityMetaCreatePayload,
	emptyEntityMetaDraft,
} from "@/lib/entityMetaDraft"
import { EntityMetaFields } from "./EntityMetaFields"

export type AddEntityMetaPillProps<TOutput = unknown, TInput = unknown> = {
	readonly label: string
	readonly dialogTitle: string
	readonly submitLabel: string
	readonly testIdPrefix: string
	readonly nameTestId: string
	readonly openButtonTestId: string
	readonly createButtonTestId: string
	readonly mutationOptions: UseMutationOptions<TOutput, Error, TInput>
	readonly invalidate: (qc: QueryClient) => Promise<void>
	readonly buildPayload: (draft: EntityMetaDraft) => TInput | undefined
	readonly onSaved?: () => void
	readonly successMessageKey?: string
	readonly errorMessageKey?: string
	readonly maxNameLength?: number
	readonly showPinned?: boolean
	readonly initialDraft?: EntityMetaDraft
	readonly pendingLabel?: string
	readonly children?: ReactNode
	/**
	 * Controlled mode: when `open` is provided, the trigger chip is not
	 * rendered — the caller's own button opens the dialog (e.g. the
	 * custom-page toolbar's add pill).
	 */
	readonly open?: boolean
	readonly onOpenChange?: (open: boolean) => void
}

/**
 * Reusable "dashed chip + dialog" for creating a simple entity-meta entity
 * (category, tag, collection, trait without extra fields, etc.).
 */
export function AddEntityMetaPill<TOutput = unknown, TInput = unknown>(
	props: AddEntityMetaPillProps<TOutput, TInput>,
) {
	const { t } = useTranslation()
	const isControlled = props.open !== undefined
	const [internalOpen, setInternalOpen] = useState(false)
	const [draft, setDraft] = useState(
		props.initialDraft ?? emptyEntityMetaDraft(),
	)
	const delayedReset = useDelayedReset()

	function resetForm() {
		setDraft(props.initialDraft ?? emptyEntityMetaDraft())
	}

	function handleOpenChange(nextOpen: boolean) {
		if (!isControlled) setInternalOpen(nextOpen)
		props.onOpenChange?.(nextOpen)
		if (!nextOpen) {
			delayedReset.schedule(resetForm)
		} else {
			delayedReset.cancel()
		}
	}

	const createMut = useSaveMutation({
		mutationOptions: props.mutationOptions,
		invalidate: props.invalidate,
		onSaved: () => {
			handleOpenChange(false)
			props.onSaved?.()
		},
		successMessageKey: props.successMessageKey,
		errorMessageKey: props.errorMessageKey,
	})

	function handleSave() {
		const payload = buildEntityMetaCreatePayload(draft)
		if (payload === undefined) return
		const built = props.buildPayload(payload)
		if (built === undefined) return
		createMut.mutate(built)
	}

	const footer = (
		<>
			<Button
				type="button"
				variant="secondary"
				onClick={() => handleOpenChange(false)}
				disabled={createMut.isPending}
			>
				{t("common.cancel")}
			</Button>
			<Button
				type="button"
				onClick={handleSave}
				disabled={createMut.isPending || draft.name.trim().length === 0}
				data-testid={props.createButtonTestId}
			>
				{createMut.isPending
					? (props.pendingLabel ?? t("common.saving"))
					: props.submitLabel}
			</Button>
		</>
	)

	return (
		<>
			{!isControlled ? (
				<span className="inline-flex">
					<button
						type="button"
						className="border-0 bg-transparent p-0"
						onClick={() => handleOpenChange(true)}
						data-testid={props.openButtonTestId}
					>
						<TagChip border="dashed" size="md">
							{props.label}
							<Add className="inline size-3 shrink-0 opacity-80" aria-hidden />
						</TagChip>
					</button>
				</span>
			) : null}
			<AppDialog
				open={isControlled ? props.open : internalOpen}
				onOpenChange={handleOpenChange}
				title={props.dialogTitle}
				size="sm"
				footer={footer}
			>
				<div className="flex flex-col gap-3.5">
					<EntityMetaFields
						value={draft}
						onChange={(patch) => setDraft({ ...draft, ...patch })}
						maxNameLength={props.maxNameLength}
						disabled={createMut.isPending}
						showPinned={props.showPinned}
						testIdPrefix={props.testIdPrefix}
						nameTestId={props.nameTestId}
					/>
					{props.children}
				</div>
			</AppDialog>
		</>
	)
}
