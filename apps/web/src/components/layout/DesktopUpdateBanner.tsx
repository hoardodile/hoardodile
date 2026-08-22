import type { DesktopUpdateState } from "@hoardodile/shared/desktop"
import { Button } from "@hoardodile/ui/components/button"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { getDesktopBridge } from "@/lib/desktop"

/**
 * In-window "update ready" strip. Tray already badges the same state;
 * this is what the user sees after Open.
 */
export function DesktopUpdateBanner() {
	const { t } = useTranslation()
	const desktop = getDesktopBridge()
	const [state, setState] = useState<DesktopUpdateState>({ status: "idle" })

	useEffect(() => {
		if (desktop === undefined) return
		void desktop.updates.status().then(setState)
		return desktop.updates.onStatus(setState)
	}, [desktop])

	if (
		desktop === undefined ||
		desktop.updates.portable ||
		state.status !== "ready"
	) {
		return null
	}

	return (
		<div
			className="flex h-control shrink-0 items-center justify-between gap-3 border-b border-border bg-muted px-3 text-ui"
			data-testid="desktop-update-banner"
		>
			<span className="min-w-0 truncate text-foreground">
				{t("me.desktop.updateBanner", { version: state.version })}
			</span>
			<Button
				size="sm"
				className="shrink-0 [-webkit-app-region:no-drag]"
				onClick={() => {
					void desktop.updates.quitAndInstall()
				}}
				data-testid="desktop-update-restart"
			>
				{t("me.desktop.updateBannerRestart")}
			</Button>
		</div>
	)
}
