import {
	Bolt,
	Global,
	Restart,
	Route as RouteIcon,
	TrashBinMinimalistic,
} from "@hoardodile/ui/icons/registry"
import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { TrashPanel } from "@/features/settings/SettingsPanels"
import { SettingsSection } from "@/features/settings/SettingsSection"
import {
	SectionDivider,
	SettingsSheet,
} from "@/features/settings/SettingsSheet"
import { SystemCachePanel } from "@/features/settings/SystemCachePanel"
import { SystemPrefsResetPanel } from "@/features/settings/SystemPrefsResetPanel"
import { StoragePanel } from "@/features/storage/StoragePanel"
import { ClearTracePanel } from "@/features/trace/components/ClearTracePanel"
import { ClearUsagePanel } from "@/features/usage/components/ClearUsagePanel"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings/data")({
	beforeLoad: requireAuth,
	component: DataSettingsRoute,
})

/**
 * Data settings tab: trash, storage accounting with the precache controls,
 * browser cache, system defaults and usage history — everything about the
 * app's local data lifecycle.
 */
function DataSettingsRoute() {
	const { t } = useTranslation()

	return (
		<SettingsSheet>
			<SettingsSection
				icon={TrashBinMinimalistic}
				title={t("me.section.trash")}
				description={t("me.trash.description")}
				layout="compact"
			>
				<TrashPanel />
			</SettingsSection>
			<SectionDivider />
			<SettingsSection
				icon={Bolt}
				title={t("storage.sectionTitle")}
				description={t("storage.sectionDescription")}
				layout="stack"
				data-testid="storage-section"
			>
				<StoragePanel />
			</SettingsSection>
			<SectionDivider />
			<SettingsSection
				icon={Global}
				title={t("me.systemCache.title")}
				description={t("me.systemCache.description")}
				layout="compact"
			>
				<SystemCachePanel />
			</SettingsSection>
			<SectionDivider />
			<SettingsSection
				icon={Restart}
				title={t("me.systemPrefs.title")}
				description={t("me.systemPrefs.description")}
				layout="compact"
			>
				<SystemPrefsResetPanel />
			</SettingsSection>
			<SectionDivider />
			<SettingsSection
				icon={RouteIcon}
				title={t("me.section.usage")}
				description={t("me.usage.description")}
				layout="stack"
				data-testid="me-section-usage"
			>
				<div className="flex flex-col">
					<ClearUsagePanel />
					<div className="my-4 h-px bg-border" />
					<ClearTracePanel />
				</div>
			</SettingsSection>
		</SettingsSheet>
	)
}
