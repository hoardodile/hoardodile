import {
	ConfirmByTypingDialog as ConfirmByTypingDialogShell,
	type ConfirmByTypingDialogProps as ConfirmByTypingDialogShellProps,
} from "@hoardodile/ui/components/confirm-by-typing-dialog"
import type { ReactNode } from "react"
import { Trans, useTranslation } from "react-i18next"

export type ConfirmByTypingDialogProps = Omit<
	ConfirmByTypingDialogShellProps,
	"prompt" | "cancelLabel"
> & {
	/** Name rendered in bold inside the confirm prompt. */
	targetName: string
	/**
	 * The one-line confirm prompt — defaults to the localized
	 * "Type <name>…</name> to confirm" with the target name bolded.
	 */
	prompt?: ReactNode
	/** Cancel button label — defaults to the localized "Cancel". */
	cancelLabel?: ReactNode
}

/**
 * The app-wired {@link ConfirmByTypingDialog} shell: the localized
 * confirm prompt and cancel label live here, everything else passes
 * through to `@hoardodile/ui/components/confirm-by-typing-dialog`.
 */
export function ConfirmByTypingDialog({
	targetName,
	prompt,
	cancelLabel,
	...props
}: ConfirmByTypingDialogProps) {
	const { t } = useTranslation()
	return (
		<ConfirmByTypingDialogShell
			{...props}
			prompt={
				prompt ?? (
					<Trans
						i18nKey="common.confirmByTypingPrompt"
						values={{ name: targetName }}
						components={{
							name: <span className="font-semibold text-foreground" />,
						}}
					/>
				)
			}
			cancelLabel={cancelLabel ?? t("common.cancel")}
		/>
	)
}
