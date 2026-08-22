import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Scale } from "@hoardodile/ui/icons/registry"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { AboutSection } from "@/features/settings/AboutSection"
import { ConnectionsSection } from "@/features/settings/ConnectionsSection"
import { LicensesDialog } from "@/features/settings/LicensesDialog"
import { SettingsSection } from "@/features/settings/SettingsSection"
import {
	SectionDivider,
	SettingsSheet,
} from "@/features/settings/SettingsSheet"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings/about")({
	beforeLoad: requireAuth,
	component: AboutSettingsRoute,
})

/**
 * About settings tab: app identity, update check, licenses and recent
 * connections — what you are running and who has been here.
 */
function AboutSettingsRoute() {
	const { t } = useTranslation()
	const [licensesOpen, setLicensesOpen] = useState(false)

	return (
		<SettingsSheet>
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
			<SectionDivider />
			<ConnectionsSection />
		</SettingsSheet>
	)
}
