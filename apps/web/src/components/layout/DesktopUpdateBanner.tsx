import type { DesktopUpdateState } from "@hoardodile/shared/desktop"
import { Button } from "@hoardodile/ui/components/button"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { getDesktopBridge } from "@/lib/desktop"

/**
 * In-window "update ready" strip plus the blocking overlay while a
 * resource update applies (the sidecar is down for a few seconds, so
 * the SPA cannot fetch — the overlay is what keeps the user calm and
 * the window alive). Tray already badges the ready state; this is what
 * the user sees after Open.
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

	if (desktop === undefined || desktop.updates.portable) return null

	if (state.status === "applying") {
		return (
			<div
				className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
				data-testid="desktop-update-applying"
			>
				<div className="w-80 rounded-lg border border-border bg-popover p-4 text-ui shadow-lg">
					<p className="text-sm font-medium text-foreground">
						{t("me.desktop.updateApplying")}
					</p>
					<p
						className="mt-1 text-xs text-muted-foreground"
						data-testid="desktop-update-applying-phase"
					>
						{t(
							state.phase === "stopping"
								? "me.desktop.updatePhaseStopping"
								: state.phase === "swapping"
									? "me.desktop.updatePhaseSwapping"
									: "me.desktop.updatePhaseStarting",
						)}
					</p>
				</div>
			</div>
		)
	}

	if (state.status !== "ready") return null
	const resources = state.channel === "resources"

	return (
		<div
			className="flex h-control shrink-0 items-center justify-between gap-3 border-b border-border bg-muted px-3 text-ui"
			data-testid="desktop-update-banner"
		>
			<span className="min-w-0 truncate text-foreground">
				{resources
					? t("me.desktop.updateBannerResources", { version: state.version })
					: t("me.desktop.updateBanner", { version: state.version })}
			</span>
			<Button
				size="sm"
				className="shrink-0 [-webkit-app-region:no-drag]"
				onClick={() => {
					void (resources
						? desktop.updates.apply()
						: desktop.updates.quitAndInstall())
				}}
				data-testid="desktop-update-restart"
			>
				{resources
					? t("me.desktop.updateBannerApply")
					: t("me.desktop.updateBannerRestart")}
			</Button>
		</div>
	)
}
