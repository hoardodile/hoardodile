import type { EntityMetaDraft } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import type { QueryClient, UseMutationOptions } from "@tanstack/react-query"
import { type ReactNode, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSaveMutation } from "@/hooks/useSaveMutation"
import { EntityMetaFields } from "./EntityMetaFields"

export type EntityMetaEditDialogProps<
	TDraft extends EntityMetaDraft,
	TInput,
	TOutput = unknown,
> = {
	readonly entityId: string
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly title: string
	readonly mutationOptions: UseMutationOptions<TOutput, Error, TInput>
	readonly invalidate: (qc: QueryClient) => Promise<void>
	readonly initialDraft: () => TDraft
	readonly buildPayload: (id: string, draft: TDraft) => TInput | undefined
	readonly successMessageKey?: string
	readonly errorMessageKey?: string
	readonly contentClassName?: string
	readonly contentTestId?: string
	readonly saveTestId?: string
	readonly nameTestId?: string
	readonly testIdPrefix?: string
	readonly maxNameLength?: number
	/** Extra save gating on top of a non-empty name. */
	readonly canSave?: (draft: TDraft) => boolean
	/** Extra side effect on save error, run in addition to the error toast. */
	readonly onSaveError?: (err: unknown, input: TInput) => void
	/**
	 * Custom form fields. Defaults to `EntityMetaFields` wired to the
	 * draft; override for drafts that need a different body (e.g. the
	 * relationship-type visual editor).
	 */
	readonly fields?: (ctx: {
		readonly draft: TDraft
		readonly patch: (patch: Partial<EntityMetaDraft>) => void
		readonly disabled: boolean
	}) => ReactNode
	/** Extra content rendered below the form fields. */
	readonly children?: ReactNode
}

/**
 * Reusable edit dialog for a simple entity-meta entity (category, tag,
 * collection, trait, relationship type, ...): owns the draft state (reset
 * on open), the save mutation lifecycle, the cancel/save footer, and the
 * dialog shell. Mirrors `AddEntityMetaPill` on the create side.
 */
export function EntityMetaEditDialog<
	TDraft extends EntityMetaDraft,
	TInput,
	TOutput = unknown,
>(props: EntityMetaEditDialogProps<TDraft, TInput, TOutput>) {
	const {
		entityId,
		open,
		onOpenChange,
		title,
		mutationOptions,
		invalidate,
		initialDraft,
		buildPayload,
		successMessageKey,
		errorMessageKey,
		contentClassName,
		contentTestId,
		saveTestId,
		nameTestId,
		testIdPrefix,
		maxNameLength,
		canSave,
		onSaveError,
		fields,
		children,
	} = props
	const { t } = useTranslation()
	const [draft, setDraft] = useState<TDraft>(initialDraft)

	useEffect(() => {
		if (!open) return
		setDraft(initialDraft())
	}, [open])

	const updateMut = useSaveMutation({
		mutationOptions,
		invalidate,
		onSaved: () => onOpenChange(false),
		successMessageKey,
		errorMessageKey,
		onSaveError,
	})

	function patch(next: Partial<EntityMetaDraft>) {
		setDraft((current) => ({ ...current, ...next }))
	}

	function handleSave() {
		const payload = buildPayload(entityId, draft)
		if (payload === undefined) return
		updateMut.mutate(payload)
	}

	const saveDisabled =
		updateMut.isPending ||
		draft.name.trim().length === 0 ||
		(canSave !== undefined && !canSave(draft))

	const footer = (
		<>
			<Button
				type="button"
				variant="secondary"
				onClick={() => onOpenChange(false)}
				disabled={updateMut.isPending}
			>
				{t("common.cancel")}
			</Button>
			<Button
				type="button"
				onClick={handleSave}
				disabled={saveDisabled}
				data-testid={saveTestId}
			>
				{updateMut.isPending ? t("common.saving") : t("common.save")}
			</Button>
		</>
	)

	const ctx = { draft, patch, disabled: updateMut.isPending }

	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			size="sm"
			footer={footer}
			contentClassName={contentClassName}
			contentTestId={contentTestId}
		>
			<div className="flex flex-col gap-3.5">
				{fields !== undefined ? (
					fields(ctx)
				) : (
					<EntityMetaFields
						value={draft}
						onChange={patch}
						maxNameLength={maxNameLength}
						disabled={updateMut.isPending}
						testIdPrefix={testIdPrefix}
						nameTestId={nameTestId}
					/>
				)}
				{children}
			</div>
		</AppDialog>
	)
}
