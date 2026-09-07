import { createFileRoute } from "@tanstack/react-router"
import { RecoveryPanel } from "@/features/protection/RecoveryPanel"
import { SettingsSheet } from "@/features/settings/SettingsSheet"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings/backups")({
	beforeLoad: requireAuth,
	component: BackupsSettingsRoute,
})

/**
 * Backups settings tab: one merged "Protection" section inside RecoveryPanel
 * (health verdict + local backup block + offsite-copy block), followed by the
 * "Available backups" and "Recent operations" sections. Backups and backup
 * sync live on one page, under one protection framing.
 */
function BackupsSettingsRoute() {
	return (
		<SettingsSheet>
			<RecoveryPanel />
		</SettingsSheet>
	)
}
