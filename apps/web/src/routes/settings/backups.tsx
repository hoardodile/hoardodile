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
 * Complete recovery points and versioned archives share one settings sheet.
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
