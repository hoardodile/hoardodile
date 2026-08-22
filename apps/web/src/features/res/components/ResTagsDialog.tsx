import type { ResCard as ResCardData } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { DualTagPicker } from "@/components/common/DualTagPicker"
import { SelectionDiffPanel } from "@/components/common/SelectionDiffPanel"
import { invalidateResources } from "@/features/res/api"
import {
	attachToResourceMutation,
	detachFromResourceMutation,
	tagKeys,
	tagsForResourceQueryOptions,
} from "@/features/tags"

export type ResTagsDialogProps = {
	readonly open: boolean
	readonly resource: Pick<ResCardData, "id" | "name">
	readonly onOpenChange: (open: boolean) => void
}

/**
 * Standalone tag-editing dialog for a resource. Extracted from the edit-hub
 * dialog so it can be opened independently from the card actions menu.
 */
export function ResTagsDialog(props: ResTagsDialogProps) {
	const { open, resource, onOpenChange } = props
	const { t } = useTranslation()
	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t("resources.tagsDialog.title", { name: resource.name })}
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
			<ResTagsPanel resId={resource.id} onSaved={() => onOpenChange(false)} />
		</AppDialog>
	)
}

function ResTagsPanel(props: {
	readonly resId: string
	readonly onSaved?: () => void
}) {
	const { resId, onSaved } = props
	const qc = useQueryClient()
	return (
		<SelectionDiffPanel
			query={tagsForResourceQueryOptions(resId)}
			getId={(t) => t.id}
			attach={attachToResourceMutation()}
			detach={detachFromResourceMutation()}
			buildPayload={(tagId) => ({ entityId: resId, tagId })}
			invalidate={async () => {
				await qc.invalidateQueries({ queryKey: tagKeys.forResource(resId) })
				await invalidateResources(qc, resId)
			}}
			submitTestId="edit-tags-submit"
			onSaved={onSaved}
		>
			{({ selected, setSelected }) => (
				<DualTagPicker
					value={selected}
					onChange={setSelected}
					kind="resource"
				/>
			)}
		</SelectionDiffPanel>
	)
}
