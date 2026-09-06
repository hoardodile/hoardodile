import { createFileRoute } from "@tanstack/react-router"
import { RecoveryPanel } from "@/features/protection/RecoveryPanel"
import { SettingsSheet } from "@/features/settings/SettingsSheet"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings/backups")({
	beforeLoad: requireAuth,
	component: BackupsSettingsRoute,
})

/**
 * Backups settings tab: complete recovery points and their jobs
 * (RecoveryPanel renders its own "Complete backups", "Available backups"
 * and "Recent operations" sections) in the unified settings rhythm.
 */
function BackupsSettingsRoute() {
	return (
		<SettingsSheet>
			<RecoveryPanel />
		</SettingsSheet>
	)
}
