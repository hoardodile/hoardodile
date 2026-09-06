import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Input } from "@hoardodile/ui/components/input"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export type CreateArchiveDialogProps = {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly onConfirm: () => void
	readonly pending: boolean
}

/**
 * Confirmation dialog shown before creating a new archive/version: a
 * typed confirmation prevents accidental clicks. Name and description
 * are set afterwards through the current version's edit dialog — the
 * archive job must not ask for metadata up front.
 */
export function CreateArchiveDialog(props: CreateArchiveDialogProps) {
	const { open, onOpenChange, onConfirm, pending } = props
	const { t } = useTranslation()
	const [typed, setTyped] = useState("")
	const confirmPhrase = t("dataHistory.confirm.archivePhrase")

	const canConfirm =
		!pending && typed.trim().toLowerCase() === confirmPhrase.toLowerCase()

	function handleOpenChange(next: boolean) {
		if (pending && !next) return
		if (!next) setTyped("")
		onOpenChange(next)
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
						onClick={() => {
							onConfirm()
							setTyped("")
						}}
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
			</div>
		</AppDialog>
	)
}
