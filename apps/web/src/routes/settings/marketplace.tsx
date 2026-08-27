import { Shop2 } from "@hoardodile/ui/icons/registry"
import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
	MarketplacePageActions,
	MarketplacePanel,
} from "@/features/marketplace"
import { SettingsSection } from "@/features/settings/SettingsSection"
import { SettingsSheet } from "@/features/settings/SettingsSheet"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings/marketplace")({
	beforeLoad: requireAuth,
	component: MarketplaceSettingsRoute,
})

/**
 * Plugin marketplace settings tab: a registry repo address + the catalog
 * of plugins published as GitHub releases (metadata read straight from
 * each repo and its latest release). The registry action bar sits above
 * the sections, like the plugins page's upload/rescan bar.
 */
function MarketplaceSettingsRoute() {
	const { t } = useTranslation()
	return (
		<>
			<MarketplacePageActions />
			<SettingsSheet>
				<SettingsSection
					icon={Shop2}
					title={t("marketplace.title")}
					description={t("marketplace.description")}
					layout="stack"
					data-testid="marketplace-section"
				>
					<MarketplacePanel />
				</SettingsSection>
			</SettingsSheet>
		</>
	)
}
