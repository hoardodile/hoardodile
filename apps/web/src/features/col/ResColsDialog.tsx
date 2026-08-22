import type { ResCard as ResCardData } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { SelectionDiffPanel } from "@/components/common/SelectionDiffPanel"
import {
	attachResourceToCollectionMutation,
	colsForResourceQueryOptions,
	detachResourceFromCollectionMutation,
	invalidateCollections,
} from "./api"
import { ColPicker } from "./ColPicker"

export type ResCollectionsDialogProps = {
	readonly open: boolean
	readonly resource: Pick<ResCardData, "id" | "name">
	readonly onOpenChange: (open: boolean) => void
}

/**
 * Standalone collections-editing dialog for a resource. Extracted from the
 * edit-hub dialog so it can be opened from the card actions menu.
 */
export function ResCollectionsDialog(props: ResCollectionsDialogProps) {
	const { open, resource, onOpenChange } = props
	const { t } = useTranslation()
	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t("collections.editDialog.title", { name: resource.name })}
			size="lg"
			footer={
				<Button
					type="button"
					variant="secondary"
					onClick={() => onOpenChange(false)}
				>
					{t("common.cancel")}
				</Button>
			}
		>
			<ResCollectionsPanel
				resId={resource.id}
				onSaved={() => onOpenChange(false)}
			/>
		</AppDialog>
	)
}

function ResCollectionsPanel(props: {
	readonly resId: string
	readonly onSaved?: () => void
}) {
	const { resId, onSaved } = props
	const qc = useQueryClient()
	return (
		<SelectionDiffPanel
			query={colsForResourceQueryOptions(resId)}
			getId={(c) => c.id}
			attach={attachResourceToCollectionMutation()}
			detach={detachResourceFromCollectionMutation()}
			buildPayload={(colId) => ({ colId, resId })}
			invalidate={async () => {
				await invalidateCollections(qc)
			}}
			submitTestId="edit-collections-submit"
			onSaved={onSaved}
		>
			{({ selected, setSelected }) => (
				<ColPicker value={selected} onChange={setSelected} />
			)}
		</SelectionDiffPanel>
	)
}
