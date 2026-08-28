import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { useTranslation } from "react-i18next"
import { TagImagePanel } from "./TagImagePanel"

/**
 * Standalone dialog hosting {@link TagImagePanel}, mirroring the
 * character image dialogs (same shell, close-only footer).
 */
export function TagImageEditDialog(props: {
	readonly open: boolean
	readonly tagId: string
	readonly tagName: string
	readonly onOpenChange: (open: boolean) => void
}) {
	const { open, tagId, tagName, onOpenChange } = props
	const { t } = useTranslation()
	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={`${tagName} — ${t("tags.edit.imageDialogTitle")}`}
			contentClassName="sm:max-w-2xl"
			footer={
				<Button
					type="button"
					variant="secondary"
					onClick={() => onOpenChange(false)}
				>
					{t("common.close")}
				</Button>
			}
		>
			<TagImagePanel tagId={tagId} onSaved={() => onOpenChange(false)} />
		</AppDialog>
	)
}
