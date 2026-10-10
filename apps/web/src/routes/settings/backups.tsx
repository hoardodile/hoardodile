import { createFileRoute } from "@tanstack/react-router"
import { RecoveryPanel } from "@/features/protection/RecoveryPanel"
import { SettingsSheet } from "@/features/settings/SettingsSheet"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings/backups")({
	beforeLoad: requireAuth,
	component: BackupsSettingsRoute,
})

/**
 * Backup settings, available recovery points and backup management share
 * the same sheet anatomy as the other settings tabs.
 */
function BackupsSettingsRoute() {
	return (
		<SettingsSheet>
			<RecoveryPanel />
		</SettingsSheet>
	)
}
