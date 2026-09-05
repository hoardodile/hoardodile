import { createFileRoute } from "@tanstack/react-router"
import { ReplicationPanel } from "@/features/protection/ReplicationPanel"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings/sync")({
	beforeLoad: requireAuth,
	component: SyncSettingsRoute,
})

/**
 * Backup transfers and optional external-sync records share this entry.
 */
function SyncSettingsRoute() {
	return <ReplicationPanel />
}
