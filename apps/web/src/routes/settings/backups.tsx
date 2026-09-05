import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
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
	const { t } = useTranslation()
	return (
		<SettingsSheet>
			<RecoveryPanel />
			<SectionDivider />
			<details>
				<summary className="cursor-pointer py-3 text-ui font-medium">
					{t("protection.archives")}
				</summary>
				<p className="mb-4 text-xs text-secondary-foreground">
					{t("protection.archivesHelp")}
				</p>
				<DataHistoryPanel embedded />
			</details>
		</SettingsSheet>
	)
}
