import { Button } from "@hoardodile/ui/components/button"
import { useTranslation } from "react-i18next"
import { getDesktopBridge } from "@/lib/desktop"
import { useDesktopUpdateState } from "./useDesktopUpdate"

/**
 * The blocking overlay while a resource update applies (the sidecar is
 * down for a few seconds, so the SPA cannot fetch — the overlay keeps the
 * user calm and the window alive). Rendered once, in the content column.
 * The tray already badges the ready state; this is what the user sees.
 */
export function DesktopUpdateOverlay() {
	const { t } = useTranslation()
	const state = useDesktopUpdateState()
	const desktop = getDesktopBridge()

	if (desktop === undefined || desktop.updates.portable) return null
	if (state?.status !== "applying") return null

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

/**
 * In-window "update ready" strip, shown as a padded row directly above
 * the Settings nav row in the left sidebar footer. The action branches on
 * the channel: resources → apply (hot swap), full → restart into the
 * installer.
 */
export function DesktopUpdateBannerRow() {
	const { t } = useTranslation()
	const state = useDesktopUpdateState()
	const desktop = getDesktopBridge()

	if (desktop === undefined || desktop.updates.portable) return null
	if (state?.status !== "ready") return null
	const resources = state.channel === "resources"

	return (
		<div
			className="flex shrink-0 items-center justify-between gap-2 bg-muted px-2 py-1.5 text-ui"
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
