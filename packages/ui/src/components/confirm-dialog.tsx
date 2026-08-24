import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { type ReactNode } from "react"
import { useTranslation } from "react-i18next"

export type ConfirmDialogProps = Readonly<{
	open: boolean
	onOpenChange: (open: boolean) => void
	title: ReactNode
	description?: ReactNode
	body?: ReactNode
	confirmLabel: ReactNode
	pendingLabel?: ReactNode
	/** Cancel button label; defaults to the shared "Cancel" copy. */
	cancelLabel?: ReactNode
	isPending: boolean
	destructive?: boolean
	confirmDisabled?: boolean
	onConfirm: () => void
	confirmTestId?: string
	cancelTestId?: string
	contentClassName?: string
	overlayClassName?: string
	contentMotion?: "default" | "minimal"
	suppressAutoFocus?: boolean
	/** When true, closing while pending is blocked. Defaults to true. */
	lockWhilePending?: boolean
}>

/**
 * Cancel + primary action dialog. Disables and (by default) blocks
 * dismissal while `isPending` so a user does not double-submit a
 * destructive action.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
	const {
		open,
		onOpenChange,
		title,
		description,
		body,
		confirmLabel,
		pendingLabel,
		cancelLabel,
		isPending,
		destructive = false,
		confirmDisabled = false,
		onConfirm,
		confirmTestId,
		cancelTestId,
		contentClassName,
		overlayClassName,
		contentMotion,
		suppressAutoFocus,
		lockWhilePending = true,
	} = props
	const { t } = useTranslation("ui", { useSuspense: false })
	function handleOpenChange(next: boolean) {
		if (lockWhilePending && isPending && !next) return
		onOpenChange(next)
	}
	const footer = (
		<>
			<Button
				variant="secondary"
				onClick={() => handleOpenChange(false)}
				disabled={isPending}
				data-testid={cancelTestId}
			>
				{cancelLabel ?? t("dialog.cancel")}
			</Button>
			<Button
				variant={destructive ? "destructive" : "default"}
				onClick={onConfirm}
				disabled={isPending || confirmDisabled}
				data-testid={confirmTestId}
			>
				{isPending && pendingLabel !== undefined ? pendingLabel : confirmLabel}
			</Button>
		</>
	)
	return (
		<AppDialog
			open={open}
			onOpenChange={handleOpenChange}
			title={title}
			description={description}
			danger={destructive}
			footer={footer}
			contentClassName={contentClassName}
			overlayClassName={overlayClassName}
			contentMotion={contentMotion}
			suppressAutoFocus={suppressAutoFocus}
		>
			{body}
		</AppDialog>
	)
}
