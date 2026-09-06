import { Archive } from "@hoardodile/ui/icons/registry"
import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { DataHistoryPanel } from "@/features/data-history"
import { RecoveryPanel } from "@/features/protection/RecoveryPanel"
import { SettingsSection } from "@/features/settings/SettingsSection"
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
 * Backups settings tab: complete recovery points (RecoveryPanel renders its
 * own "Complete backups", "Available backups" and "Recent operations"
 * sections) followed by the historical-archives browser as a route-owned
 * section of the same unified rhythm.
 */
function BackupsSettingsRoute() {
	const { t } = useTranslation()
	return (
		<SettingsSheet>
			<RecoveryPanel />
			<SectionDivider />
			<SettingsSection
				icon={Archive}
				title={t("protection.archives")}
				description={t("protection.archivesHelp")}
				layout="stack"
				data-testid="archives-section"
			>
				<DataHistoryPanel embedded />
			</SettingsSection>
		</SettingsSheet>
	)
}
