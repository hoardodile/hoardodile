import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Input } from "@hoardodile/ui/components/input"
import { type ReactNode } from "react"
import { Trans, useTranslation } from "react-i18next"

export type ConfirmByTypingDialogProps = Readonly<{
	open: boolean
	onOpenChange(open: boolean): void
	title: string
	description: string
	/** Exact string the user must type to enable the confirm button. */
	expectedInput: string
	/**
	 * The target name rendered in bold inside the one-line confirm prompt.
	 */
	targetName: string
	confirmLabel: string
	pendingLabel: string
	pending: boolean
	/** When true the dialog takes the danger register (destructive header
	    ink) and the confirm button uses the destructive variant. */
	destructive?: boolean
	typed: string
	onTypedChange(value: string): void
	onConfirm(): void
	/**
	 * The one-line confirm prompt (rendered below the description) —
	 * defaults to the shared "Type <name>…</name> to confirm" copy with
	 * the target name bolded.
	 */
	prompt?: ReactNode
	/** Cancel button label — defaults to the shared "Cancel" copy. */
	cancelLabel?: ReactNode
	inputTestId?: string
	confirmTestId?: string
	/** Forwarded to the dialog content (e.g. theme scope classes). */
	contentClassName?: string
}>

/**
 * Shared "type the name to confirm" dialog for any operation that
 * requires the user to re-read a target name and type it back. The
 * type-to-confirm anatomy: the consequence reads in the header
 * description, the target name sits in bold inside the one-line prompt
 * (`Type “harbor” to confirm`), and the confirm stays gated until the
 * input matches. The prompt is rendered uniformly; only the bold target
 * name varies.
 */
export function ConfirmByTypingDialog(props: ConfirmByTypingDialogProps) {
	const {
		open,
		onOpenChange,
		title,
		description,
		expectedInput,
		confirmLabel,
		pendingLabel,
		pending,
		destructive = true,
		typed,
		onTypedChange,
		onConfirm,
		targetName,
		prompt,
		cancelLabel,
		inputTestId,
		confirmTestId,
		contentClassName,
	} = props
	const { t } = useTranslation("ui", { useSuspense: false })
	const canConfirm = !pending && typed === expectedInput
	function handleOpenChange(next: boolean) {
		if (pending && !next) return
		onOpenChange(next)
	}
	return (
		<AppDialog
			open={open}
			onOpenChange={handleOpenChange}
			title={title}
			description={description}
			danger={destructive}
			contentClassName={contentClassName}
			footer={
				<>
					<Button
						variant="secondary"
						onClick={() => onOpenChange(false)}
						disabled={pending}
					>
						{cancelLabel ?? t("dialog.cancel")}
					</Button>
					<Button
						variant={destructive ? "destructive" : "default"}
						disabled={!canConfirm}
						onClick={onConfirm}
						data-testid={confirmTestId}
					>
						{pending ? pendingLabel : confirmLabel}
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-1.5">
				<span className="text-xs text-muted-foreground">
					{prompt ?? (
						<Trans
							ns="ui"
							i18nKey="confirmByTyping.prompt"
							values={{ name: targetName }}
							components={{
								name: (
									<span className="font-semibold text-foreground" />
								),
							}}
						/>
					)}
				</span>
				<Input
					autoFocus
					value={typed}
					onChange={(e) => onTypedChange(e.target.value)}
					autoComplete="off"
					data-testid={inputTestId}
				/>
			</div>
		</AppDialog>
	)
}
