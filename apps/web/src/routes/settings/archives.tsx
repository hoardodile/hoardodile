import { History } from "@hoardodile/ui/icons/registry"
import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { DataHistoryPanel } from "@/features/data-history"
import { SettingsSection } from "@/features/settings/SettingsSection"
import { SettingsSheet } from "@/features/settings/SettingsSheet"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings/archives")({
	beforeLoad: requireAuth,
	component: ArchivesSettingsRoute,
})

/**
 * Archives settings tab: the historical-archives browser as its own
 * route-owned section of the unified settings rhythm — the backups tab
 * stays focused on complete recovery points and their jobs.
 */
function ArchivesSettingsRoute() {
	const { t } = useTranslation()
	return (
		<SettingsSheet>
			<SettingsSection
				icon={History}
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
