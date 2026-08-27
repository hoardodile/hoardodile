import { Eraser, File, Layers, Restart } from "@hoardodile/ui/icons/registry"
import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
	BundledPluginsSection,
	FilePluginPill,
	InstalledPluginsPanel,
	PluginCachesPanel,
	PluginDefaultsPanel,
	PluginPageActions,
} from "@/features/plugin"
import { SettingsSection } from "@/features/settings/SettingsSection"
import {
	SectionDivider,
	SettingsSheet,
} from "@/features/settings/SettingsSheet"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings/plugins")({
	beforeLoad: requireAuth,
	component: PluginsSettingsRoute,
})

/**
 * Plugins settings tab: five clean sections in the shared settings
 * rhythm: Installed (the priority list that decides who claims content),
 * Bundled (removed seeds, restored offline — hidden when nothing is
 * restorable), File (the built-in fallback), Defaults and cache
 * (plugin-wide maintenance as compact one-liners).
 */
function PluginsSettingsRoute() {
	const { t } = useTranslation()
	return (
		<>
			<PluginPageActions />
			<SettingsSheet>
				<SettingsSection
					icon={Layers}
					title={t("plugins.installed")}
					description={t("plugins.installedDescription")}
					layout="stack"
					data-testid="plugins-installed-section"
				>
					<InstalledPluginsPanel />
				</SettingsSection>
				<BundledPluginsSection />
				<SectionDivider />
				<SettingsSection
					icon={File}
					title={t("plugins.fileTitle")}
					description={t("plugins.fileDescription")}
					layout="compact"
					data-testid="plugins-file-section"
				>
					<FilePluginPill />
				</SettingsSection>
				<SectionDivider />
				<SettingsSection
					icon={Restart}
					title={t("plugins.defaultsTitle")}
					description={t("plugins.defaultsDescription")}
					layout="compact"
					data-testid="plugins-defaults-section"
				>
					<PluginDefaultsPanel />
				</SettingsSection>
				<SectionDivider />
				<SettingsSection
					icon={Eraser}
					title={t("plugins.cachesTitle")}
					description={t("plugins.cachesDescription")}
					layout="compact"
					data-testid="plugins-caches-section"
				>
					<PluginCachesPanel />
				</SettingsSection>
			</SettingsSheet>
		</>
	)
}
