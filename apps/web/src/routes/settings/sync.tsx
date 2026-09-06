import { createFileRoute } from "@tanstack/react-router"
import { ReplicationPanel } from "@/features/protection/ReplicationPanel"
import { SettingsSheet } from "@/features/settings/SettingsSheet"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings/sync")({
	beforeLoad: requireAuth,
	component: SyncSettingsRoute,
})

/**
 * Sync settings tab: backup transfers and external-sync records share one
 * sheet — the ReplicationPanel renders its own "Backup sync" and "Devices"
 * sections in the unified settings rhythm.
 */
function SyncSettingsRoute() {
	return (
		<SettingsSheet>
			<ReplicationPanel />
		</SettingsSheet>
	)
}
