import { MAX_NAME_LENGTH } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Input } from "@hoardodile/ui/components/input"
import { cn } from "@hoardodile/ui/lib/utils"
import { useTranslation } from "react-i18next"
import { useDocTheme } from "@/features/doc/hooks/useDocPrefs"

export type DocRenameDialogProps = Readonly<{
	open: boolean
	onOpenChange(open: boolean): void
	/** Node being renamed — names the test ids and picks the title copy. */
	nodeId: string
	kind: "folder" | "document"
	value: string
	onValueChange(value: string): void
	isPending: boolean
	onSubmit(): void
}>

/**
 * Rename a tree node. The tree row is too narrow to edit a name in place
 * (deep nesting leaves the field a sliver next to its confirm buttons),
 * so the row menu opens this single-field dialog instead; the dialog
 * focuses the field, pre-selects the current name so typing replaces it,
 * and Enter commits.
 */
export function DocRenameDialog(props: DocRenameDialogProps) {
	const { open, onOpenChange, nodeId, kind, value, onValueChange } = props
	const { isPending, onSubmit } = props
	const { t } = useTranslation()
	const { themeClass } = useDocTheme()
	return (
		<AppDialog
			open={open}
			onOpenChange={(next) => {
				if (!isPending) onOpenChange(next)
			}}
			title={
				kind === "folder"
					? t("documents.renameDialog.folderTitle")
					: t("documents.renameDialog.documentTitle")
			}
			contentClassName={cn("doc", themeClass)}
			// A rename dialog exists to be typed into: land focus on the
			// field, not on the dialog container.
			suppressAutoFocus={false}
			footer={
				<>
					<Button
						variant="secondary"
						onClick={() => onOpenChange(false)}
						disabled={isPending}
						data-testid={`documents-rename-cancel-${nodeId}`}
					>
						{t("common.cancel")}
					</Button>
					<Button
						onClick={onSubmit}
						disabled={isPending || value.trim().length === 0}
						data-testid={`documents-rename-confirm-${nodeId}`}
					>
						{isPending ? t("common.saving") : t("common.save")}
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-2">
				<label
					htmlFor={`documents-rename-input-${nodeId}`}
					className="text-sm font-medium"
				>
					{t("documents.renameDialog.nameLabel")}
				</label>
				<Input
					id={`documents-rename-input-${nodeId}`}
					value={value}
					onChange={(e) => onValueChange(e.target.value)}
					// The dialog hands the field focus on open; taking the
					// focus event as the trigger selects the current name so
					// typing replaces it (a click inside the already-focused
					// field never re-fires it).
					onFocus={(e) => e.currentTarget.select()}
					onKeyDown={(e) => {
						if (e.key === "Enter") onSubmit()
					}}
					maxLength={MAX_NAME_LENGTH}
					autoComplete="off"
					data-testid={`documents-rename-input-${nodeId}`}
				/>
			</div>
		</AppDialog>
	)
}
