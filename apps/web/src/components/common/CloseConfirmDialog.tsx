import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Checkbox } from "@hoardodile/ui/components/checkbox"
import { useState } from "react"
import { useTranslation } from "react-i18next"

/**
 * The caption close confirmation: hide to tray (primary), quit, or cancel,
 * plus a "remember my choice" checkbox that persists the preference — the
 * same setting the app settings page exposes directly. Shown by the
 * DesktopCaptionBar when the configured close action is "ask".
 */
export function CloseConfirmDialog(props: {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly onDecide: (action: "tray" | "quit", remember: boolean) => void
}) {
	const { open, onOpenChange, onDecide } = props
	const { t } = useTranslation()
	const [remember, setRemember] = useState(false)

	const footer = (
		<>
			<Button
				variant="secondary"
				onClick={() => {
					onOpenChange(false)
				}}
				data-testid="close-confirm-cancel"
			>
				{t("common.cancel")}
			</Button>
			<Button
				variant="secondary"
				onClick={() => {
					onDecide("quit", remember)
				}}
				data-testid="close-confirm-quit"
			>
				{t("me.desktop.closeConfirm.quit")}
			</Button>
			<Button
				variant="default"
				onClick={() => {
					onDecide("tray", remember)
				}}
				data-testid="close-confirm-tray"
			>
				{t("me.desktop.closeConfirm.tray")}
			</Button>
		</>
	)

	return (
		<AppDialog
			open={open}
			onOpenChange={(next) => {
				onOpenChange(next)
			}}
			title={t("me.desktop.closeConfirm.title")}
			description={t("me.desktop.closeConfirm.description")}
			footer={footer}
		>
			<label
				className="flex cursor-pointer items-center gap-2 select-none"
				htmlFor="close-confirm-remember"
				data-testid="close-confirm-remember"
			>
				<Checkbox
					id="close-confirm-remember"
					checked={remember}
					onCheckedChange={(checked) => {
						setRemember(checked === true)
					}}
				/>
				<span className="text-xs text-muted-foreground">
					{t("me.desktop.closeConfirm.remember")}
				</span>
			</label>
		</AppDialog>
	)
}
