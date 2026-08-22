import {
	CloseConfirmDialog as CloseConfirmDialogShell,
	type CloseConfirmDialogStrings,
} from "@hoardodile/ui/components/close-confirm-dialog"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

export type CloseConfirmDialogProps = {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly onDecide: (action: "tray" | "quit", remember: boolean) => void
}

/**
 * The app-wired close confirmation: the shared ui dialog with localized
 * strings (react-i18next). The desktop shell pushes the same strings'
 * underlying language so its shell pages and native dialog match.
 */
export function CloseConfirmDialog(props: CloseConfirmDialogProps) {
	const { t } = useTranslation()
	const strings = useMemo<CloseConfirmDialogStrings>(
		() => ({
			title: t("me.desktop.closeConfirm.title"),
			description: t("me.desktop.closeConfirm.description"),
			tray: t("me.desktop.closeConfirm.tray"),
			quit: t("me.desktop.closeConfirm.quit"),
			cancel: t("common.cancel"),
			remember: t("me.desktop.closeConfirm.remember"),
		}),
		[t],
	)
	return <CloseConfirmDialogShell {...props} strings={strings} />
}
