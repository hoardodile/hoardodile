import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Input } from "@hoardodile/ui/components/input"
import { Textarea } from "@hoardodile/ui/components/textarea"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export type CreateArchiveDialogProps = {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly onConfirm: (input: { readonly note?: string }) => void
	readonly pending: boolean
}

/**
 * Confirmation dialog shown before creating a new archive/version.
 *
 * Combines a typed confirmation (to prevent accidental clicks) with an
 * optional note field so the user can label the milestone.
 */
export function CreateArchiveDialog(props: CreateArchiveDialogProps) {
	const { open, onOpenChange, onConfirm, pending } = props
	const { t } = useTranslation()
	const [typed, setTyped] = useState("")
	const [note, setNote] = useState("")
	const confirmPhrase = t("dataHistory.confirm.archivePhrase")

	const canConfirm =
		!pending && typed.trim().toLowerCase() === confirmPhrase.toLowerCase()

	function handleOpenChange(next: boolean) {
		if (pending && !next) return
		if (!next) {
			setTyped("")
			setNote("")
		}
		onOpenChange(next)
	}

	function handleConfirm() {
		const trimmed = note.trim()
		onConfirm({ note: trimmed.length > 0 ? trimmed : undefined })
		setTyped("")
		setNote("")
	}

	return (
		<AppDialog
			open={open}
			onOpenChange={handleOpenChange}
			title={t("dataHistory.confirm.archiveTitle")}
			description={t("dataHistory.confirm.archiveDescription")}
			footer={
				<>
					<Button
						variant="secondary"
						onClick={() => handleOpenChange(false)}
						disabled={pending}
					>
						{t("common.cancel")}
					</Button>
					<Button
						onClick={handleConfirm}
						disabled={!canConfirm}
						data-testid="archive-confirm-submit"
					>
						{pending
							? t("dataHistory.action.archiving")
							: t("dataHistory.action.archiveNow")}
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				<div>
					<p className="text-sm text-muted-foreground">
						{t("common.confirmByTypingPrompt")}
					</p>
					<p className="text-sm mb-3">
						<span className="font-bold">{confirmPhrase}</span>
					</p>
					<Input
						autoFocus
						value={typed}
						onChange={(e) => setTyped(e.target.value)}
						autoComplete="off"
						data-testid="archive-confirm-input"
						disabled={pending}
					/>
					<p className="mt-2 text-xs text-muted-foreground">
						{t("dataHistory.confirm.archiveAutoHint")}
					</p>
				</div>
				<div>
					<p className="text-sm text-muted-foreground mb-1.5">
						{t("dataHistory.archive.noteLabel")}
					</p>
					<Textarea
						value={note}
						onChange={(e) => setNote(e.target.value)}
						placeholder={t("dataHistory.archive.notePlaceholder")}
						rows={2}
						className="min-h-[60px] resize-none"
						disabled={pending}
						data-testid="archive-note-input"
					/>
				</div>
			</div>
		</AppDialog>
	)
}
