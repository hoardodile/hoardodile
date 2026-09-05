import { createFileRoute } from "@tanstack/react-router"
import { DataHistoryPanel } from "@/features/data-history"
import { RecoveryPanel } from "@/features/protection/RecoveryPanel"
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
 * Archive settings tab: backup/archive actions and the writability
 * status above the sheet, backup & archive history on one timeline with
 * a detail card for the selected event.
 */
function BackupsSettingsRoute() {
	return (
		<SettingsSheet>
			<RecoveryPanel />
			<SectionDivider />
			<DataHistoryPanel embedded />
		</SettingsSheet>
	)
}
