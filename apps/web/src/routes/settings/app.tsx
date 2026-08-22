import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import {
	Bolt,
	Global,
	Restart,
	Route as RouteIcon,
	Scale,
	TrashBinMinimalistic,
} from "@hoardodile/ui/icons/registry"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { AboutSection } from "@/features/settings/AboutSection"
import { DesktopLibrarySection } from "@/features/settings/DesktopLibrarySection"
import { LanSharingSection } from "@/features/settings/LanSharingSection"
import { LicensesDialog } from "@/features/settings/LicensesDialog"
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

export const Route = createFileRoute("/settings/app")({
	beforeLoad: requireAuth,
	component: AppSettingsRoute,
})

/**
 * App settings tab: trash, system defaults and browser cache as compact
 * rows, usage history (sessions + footprint log), storage accounting
 * with the precache controls, about and licenses — one sheet.
 */
function AppSettingsRoute() {
	const { t } = useTranslation()
	const [licensesOpen, setLicensesOpen] = useState(false)

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
				icon={Restart}
				title={t("me.systemPrefs.title")}
				description={t("me.systemPrefs.description")}
				layout="compact"
			>
				<SystemPrefsResetPanel />
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
			<DesktopLibrarySection />
			<LanSharingSection />
			<AboutSection />
			<SectionDivider />
			<SettingsSection
				icon={Scale}
				title={t("me.licenses.title")}
				description={t("me.licenses.description")}
				layout="compact"
			>
				<Button
					variant="secondary"
					onClick={() => setLicensesOpen(true)}
					data-testid="me-licenses-button"
				>
					<Icon icon={Scale} />
					{t("me.licenses.viewButton")}
				</Button>
				<LicensesDialog open={licensesOpen} onOpenChange={setLicensesOpen} />
			</SettingsSection>
		</SettingsSheet>
	)
}
