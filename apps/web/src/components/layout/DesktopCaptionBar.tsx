import { CaptionBar } from "@hoardodile/ui/components/caption-bar"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { CloseConfirmDialog } from "@/components/common/CloseConfirmDialog"
import { getDesktopBridge } from "@/lib/desktop"

/**
 * Electron caption strip. No-op in a browser tab. AppShell places this at
 * the top of the content column (canvas + panel), not over the sidebar.
 *
 * The close button is intercepted here: when the persisted close action is
 * "ask" the in-app confirm dialog opens (hide to tray / quit / cancel with
 * a remember checkbox); otherwise the shell's configured action runs
 * directly. OS-level closes (Alt+F4, taskbar) route through the main
 * process guard, which falls back to a native dialog in the same shape.
 */
export function DesktopCaptionBar() {
	const { t, i18n } = useTranslation()
	const desktop = getDesktopBridge()
	const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)

	if (desktop === undefined) return null
	// Local binding so the closures below see the narrowed type.
	const bridge = desktop

	// The shell's static pages and native ask dialog render the user's
	// language from the shared i18n catalogs; push the resolved language
	// whenever it changes so they match the SPA.
	useEffect(() => {
		bridge.setLanguage(i18n.language)
	}, [bridge, i18n.language])

	function handleClose() {
		void bridge.getConfig().then((config) => {
			if (config.closeAction === "ask") {
				setCloseConfirmOpen(true)
			} else {
				bridge.close()
			}
		})
	}

	function handleDecide(action: "tray" | "quit", remember: boolean) {
		setCloseConfirmOpen(false)
		void bridge.closeWithAction(action, remember)
	}

	return (
		<>
			<CaptionBar
				controls={{ ...bridge, close: handleClose }}
				labels={{
					minimize: t("me.desktop.caption.minimize"),
					maximize: t("me.desktop.caption.maximize"),
					restore: t("me.desktop.caption.restore"),
					close: t("me.desktop.caption.close"),
					back: t("me.desktop.caption.back"),
					forward: t("me.desktop.caption.forward"),
					reload: t("me.desktop.caption.reload"),
				}}
			/>
			<CloseConfirmDialog
				open={closeConfirmOpen}
				onOpenChange={setCloseConfirmOpen}
				onDecide={handleDecide}
			/>
		</>
	)
}
