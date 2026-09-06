import { ConfirmByTypingDialog } from "@hoardodile/ui/components/confirm-by-typing-dialog"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export type CreateArchiveDialogProps = {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly onConfirm: () => void
	readonly pending: boolean
}

/**
 * Confirmation dialog shown before creating a new archive/version: the
 * shared type-to-confirm anatomy («请输入"归档"以确认» — phrase in bold
 * inside the one-line prompt, input below) prevents accidental clicks.
 * Name and description are set afterwards through the current version's
 * edit dialog — the archive job must not ask for metadata up front.
 */
export function CreateArchiveDialog(props: CreateArchiveDialogProps) {
	const { open, onOpenChange, onConfirm, pending } = props
	const { t } = useTranslation()
	const [typed, setTyped] = useState("")
	const phrase = t("dataHistory.confirm.archivePhrase")

	return (
		<ConfirmByTypingDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) setTyped("")
				onOpenChange(next)
			}}
			title={t("dataHistory.confirm.archiveTitle")}
			description={t("dataHistory.confirm.archiveDescription")}
			expectedInput={phrase}
			targetName={phrase}
			confirmLabel={t("dataHistory.action.archiveNow")}
			pendingLabel={t("dataHistory.action.archiving")}
			pending={pending}
			destructive={false}
			typed={typed}
			onTypedChange={setTyped}
			onConfirm={() => {
				onConfirm()
				setTyped("")
			}}
			inputTestId="archive-confirm-input"
			confirmTestId="archive-confirm-submit"
		/>
	)
}
