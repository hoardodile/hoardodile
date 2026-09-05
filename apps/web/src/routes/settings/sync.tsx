import { createFileRoute } from "@tanstack/react-router"
import { ReplicationPanel } from "@/features/protection/ReplicationPanel"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings/sync")({
	beforeLoad: requireAuth,
	component: SyncSettingsRoute,
})

/**
 * Sync settings tab: automatic state snapshots. Devices live as
 * standalone floating cards on the canvas — one card per device, never
 * nested inside a sheet — with the reminder interval as its own compact
 * card. The feature only stores records — it never connects to any sync
 * software.
 */
function SyncSettingsRoute() {
	return <ReplicationPanel />
}
