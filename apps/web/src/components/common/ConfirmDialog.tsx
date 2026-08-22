import {
	ConfirmDialog as ConfirmDialogShell,
	type ConfirmDialogProps as ConfirmDialogShellProps,
} from "@hoardodile/ui/components/confirm-dialog"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

export type ConfirmDialogProps = Omit<
	ConfirmDialogShellProps,
	"cancelLabel"
> & {
	/** Cancel button label — defaults to the localized "Cancel". */
	cancelLabel?: ReactNode
}

/**
 * The app-wired {@link ConfirmDialog} shell: the localized cancel label
 * lives here, everything else passes through to
 * `@hoardodile/ui/components/confirm-dialog`.
 */
export function ConfirmDialog({ cancelLabel, ...props }: ConfirmDialogProps) {
	const { t } = useTranslation()
	return (
		<ConfirmDialogShell
			{...props}
			cancelLabel={cancelLabel ?? t("common.cancel")}
		/>
	)
}
