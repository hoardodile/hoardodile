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
 * Backups settings tab: the "Backups" section (RecoveryPanel — which leads
 * with either the health verdict or the inline setup chooser) and the
 * backup-sync service (paired devices). Backups and backup sync live on
 * one page.
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
