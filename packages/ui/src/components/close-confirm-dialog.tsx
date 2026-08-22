import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Checkbox } from "@hoardodile/ui/components/checkbox"
import { useEffect, useState } from "react"

export type CloseConfirmDialogStrings = {
	readonly title: string
	readonly description: string
	readonly tray: string
	readonly quit: string
	readonly cancel: string
	readonly remember: string
}

export type CloseConfirmDialogProps = {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly onDecide: (action: "tray" | "quit", remember: boolean) => void
	readonly strings: CloseConfirmDialogStrings
}

/**
 * The shared close confirmation: hide to tray (primary), quit, or cancel,
 * plus a "remember my choice" checkbox. Used by the SPA caption (strings
 * from react-i18next) and the shell's static pages / native dialog (the
 * localized catalogs). The three-button footer follows DESIGN.md: quit at
 * the left edge, cancel and the primary action right-aligned.
 */
export function CloseConfirmDialog(props: CloseConfirmDialogProps) {
	const { open, onOpenChange, onDecide, strings } = props
	const [remember, setRemember] = useState(false)

	// One-shot choice: the checkbox applies only to the close it was
	// checked on. Resetting it whenever the dialog closes stops a stale
	// check from re-persisting the old action (and undoing the Settings →
	// App preference) the next time the dialog opens.
	useEffect(() => {
		if (!open) setRemember(false)
	}, [open])

	const footer = (
		<>
			{/* Three-button footer (DESIGN.md — Overlays): the secondary
			    function key (quit) sits at the left edge; cancel and the
			    primary action (hide to tray) stay right-aligned. */}
			<Button
				variant="secondary"
				className="mr-auto"
				onClick={() => {
					onDecide("quit", remember)
				}}
				data-testid="close-confirm-quit"
			>
				{strings.quit}
			</Button>
			<Button
				variant="secondary"
				onClick={() => {
					onOpenChange(false)
				}}
				data-testid="close-confirm-cancel"
			>
				{strings.cancel}
			</Button>
			<Button
				variant="default"
				onClick={() => {
					onDecide("tray", remember)
				}}
				data-testid="close-confirm-tray"
			>
				{strings.tray}
			</Button>
		</>
	)

	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={strings.title}
			description={strings.description}
			footer={footer}
		>
			{/* The checkbox is the only toggle (no label row); `py-2` keeps
			    it from sitting flush against the description and the
			    footer hairline. */}
			<div
				className="flex items-center gap-2 py-2 select-none"
				data-testid="close-confirm-remember"
			>
				<Checkbox
					checked={remember}
					onCheckedChange={(checked) => {
						setRemember(checked === true)
					}}
					aria-label={strings.remember}
				/>
				<span className="text-xs text-muted-foreground">
					{strings.remember}
				</span>
			</div>
		</AppDialog>
	)
}
