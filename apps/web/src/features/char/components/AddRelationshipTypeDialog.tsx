import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useDelayedReset } from "@/hooks/useDelayedReset"
import { useSaveMutation } from "@/hooks/useSaveMutation"
import {
	createRelationshipTypeMutation,
	invalidateRelationshipTypes,
} from "../api"
import { RelationshipTypeDialogBody } from "./RelationshipTypeDialogBody"
import {
	buildCreateTypePayload,
	emptyRelationshipTypeDraft,
	isRelationshipTypeDefinitionComplete,
	type RelationshipTypeFormDraft,
} from "./RelationshipTypeFormFields"

/**
 * Create-relationship-type dialog — shared by the custom page's
 * Relationships tab and the character search's relation filter
 * quick-add.
 */
export function AddRelationshipTypeDialog(props: {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}) {
	const { open, onOpenChange } = props
	const { t } = useTranslation()
	const [draft, setDraft] = useState(emptyRelationshipTypeDraft)
	const delayedReset = useDelayedReset()

	function resetForm() {
		setDraft(emptyRelationshipTypeDraft())
	}

	const createMut = useSaveMutation({
		mutationOptions: createRelationshipTypeMutation(),
		invalidate: invalidateRelationshipTypes,
		onSaved: () => handleOpenChange(false),
		successMessageKey: "relationshipTypes.toast.created",
		errorMessageKey: "relationshipTypes.toast.createFailed",
	})

	function handlePatch(patch: Partial<RelationshipTypeFormDraft>) {
		setDraft((current) => ({ ...current, ...patch }))
	}

	function handleSave() {
		const payload = buildCreateTypePayload(draft)
		if (payload === undefined) return
		createMut.mutate(payload)
	}

	function handleOpenChange(nextOpen: boolean) {
		onOpenChange(nextOpen)
		if (!nextOpen) {
			delayedReset.schedule(resetForm)
		} else {
			delayedReset.cancel()
		}
	}

	const canSave =
		draft.name.trim().length > 0 &&
		isRelationshipTypeDefinitionComplete(draft) &&
		!createMut.isPending

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
				disabled={!canSave}
				data-testid="relationship-type-add"
			>
				{createMut.isPending ? t("common.saving") : t("me.custom.add")}
			</Button>
		</>
	)

	return (
		<AppDialog
			open={open}
			onOpenChange={handleOpenChange}
			title={t("relationshipTypes.panel.addDialogTitle")}
			footer={footer}
			contentClassName="sm:max-w-lg"
		>
			<RelationshipTypeDialogBody
				draft={draft}
				onChange={handlePatch}
				nameTestId="relationship-type-name"
				metaTestIdPrefix="relationship-type-add"
			/>
		</AppDialog>
	)
}
