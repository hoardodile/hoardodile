import { CaptionBar } from "@hoardodile/ui/components/caption-bar"
import { useTranslation } from "react-i18next"
import { getDesktopBridge } from "@/lib/desktop"

/**
 * Electron caption strip. No-op in a browser tab. AppShell places this at
 * the top of the content column (canvas + panel), not over the sidebar.
 */
export function DesktopCaptionBar() {
	const { t } = useTranslation()
	const desktop = getDesktopBridge()

	if (desktop === undefined) return null
	return (
		<CaptionBar
			controls={desktop}
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
	)
}
