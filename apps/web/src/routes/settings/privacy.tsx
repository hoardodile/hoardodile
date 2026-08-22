import { Login2 } from "@hoardodile/ui/icons/registry"
import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { AutoSignOutControls } from "@/features/privacy/PrivacySettingsPanel"
import { SettingsSection } from "@/features/settings/SettingsSection"
import { SettingsSheet } from "@/features/settings/SettingsSheet"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings/privacy")({
	beforeLoad: requireAuth,
	component: PrivacySettingsRoute,
})

/**
 * Privacy & security settings tab: automatic sign-out.
 */
function PrivacySettingsRoute() {
	const { t } = useTranslation()
	return (
		<SettingsSheet>
			<SettingsSection
				icon={Login2}
				title={t("me.privacy.signOutSection.title")}
				description={t("me.privacy.signOutSection.description")}
				layout="stack"
				data-testid="privacy-signout-section"
			>
				<AutoSignOutControls />
			</SettingsSection>
		</SettingsSheet>
	)
}
