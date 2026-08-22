import { createFileRoute, redirect } from "@tanstack/react-router"
import { DesktopLibrarySection } from "@/features/settings/DesktopLibrarySection"
import { LanSharingSection } from "@/features/settings/LanSharingSection"
import { SettingsSheet } from "@/features/settings/SettingsSheet"
import { ShellCachePanel } from "@/features/settings/ShellCachePanel"
import { requireAuth } from "@/lib/auth-guard"
import { isHoardodileDesktop } from "@/lib/desktop"

export const Route = createFileRoute("/settings/desktop")({
	/**
	 * Desktop-shell-only tab: the route keeps existing for deep links, but
	 * a normal browser tab redirects back to Preferences (the tab itself is
	 * hidden by `visibleSettingsTabs`).
	 */
	async beforeLoad(ctx) {
		await requireAuth(ctx)
		if (!isHoardodileDesktop()) {
			throw redirect({ to: "/settings" })
		}
	},
	component: DesktopSettingsRoute,
})

/**
 * Desktop settings tab: library folder and shell behavior, shared-folder
 * import root, local-network sharing and the shell's own cache cleanup.
 * Rendered only by the Electron shell (the tab is hidden elsewhere).
 */
function DesktopSettingsRoute() {
	return (
		<SettingsSheet>
			<DesktopLibrarySection />
			<LanSharingSection />
			<ShellCachePanel />
		</SettingsSheet>
	)
}
