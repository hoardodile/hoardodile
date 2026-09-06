import { createFileRoute } from "@tanstack/react-router"
import { RecoveryPanel } from "@/features/protection/RecoveryPanel"
import { ReplicationPanel } from "@/features/protection/ReplicationPanel"
import {
	SectionDivider,
	SettingsSheet,
} from "@/features/settings/SettingsSheet"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings/backups")({
	beforeLoad: requireAuth,
	component: BackupsSettingsRoute,
})

/**
 * Backups settings tab: complete recovery points and their jobs
 * (RecoveryPanel renders its own "Complete backups", "Available backups"
 * and "Recent operations" sections) followed by the backup-sync service
 * and its paired devices (ReplicationPanel) — backups and backup sync
 * live on one page.
 */
function BackupsSettingsRoute() {
	return (
		<SettingsSheet>
			<RecoveryPanel />
			<SectionDivider />
			<ReplicationPanel />
		</SettingsSheet>
	)
}
