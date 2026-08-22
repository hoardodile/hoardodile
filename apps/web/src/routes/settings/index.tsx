import {
	CalendarDate,
	PaletteRound,
	Star,
	TextFormat as Text,
	Translation,
} from "@hoardodile/ui/icons/registry"
import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { DateTimeSettingsPanel } from "@/features/settings/DateTimeSettingsPanel"
import { useDateFormatter } from "@/features/settings/datePrefs"
import { FontSettingsPanel } from "@/features/settings/FontSettingsPanel"
import { IconSettingsPanel } from "@/features/settings/IconSettingsPanel"
import { LanguageSettingsPanel } from "@/features/settings/LanguageSettingsPanel"
import { PasswordSection } from "@/features/settings/PasswordSection"
import { SignOutSection } from "@/features/settings/SettingsPanels"
import { SettingsSection } from "@/features/settings/SettingsSection"
import {
	SectionDivider,
	SettingsSheet,
} from "@/features/settings/SettingsSheet"
import { ThemeSettingsPanel } from "@/features/settings/ThemeSettingsPanel"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings/")({
	beforeLoad: requireAuth,
	component: AccountSettingsRoute,
})

/**
 * Preferences settings tab. Sign-out, password, language, date/time,
 * theme and font — one sheet, compact sections pinned to their controls,
 * the theme and font blocks stacked under wide content.
 */
function AccountSettingsRoute() {
	const { t } = useTranslation()
	const { formatDateTime } = useDateFormatter()

	return (
		<SettingsSheet>
			<SignOutSection />
			<SectionDivider />
			<PasswordSection />
			<SectionDivider />
			<SettingsSection
				icon={Translation}
				title={t("me.section.language")}
				description={t("language.description")}
				layout="compact"
			>
				<LanguageSettingsPanel />
			</SettingsSection>
			<SectionDivider />
			<SettingsSection
				icon={Star}
				title={t("me.section.icons")}
				description={t("icons.description")}
				layout="compact"
			>
				<IconSettingsPanel />
			</SettingsSection>
			<SectionDivider />
			<SettingsSection
				icon={CalendarDate}
				title={t("me.section.dateTime")}
				description={t("dateTime.description", {
					preview: formatDateTime(Date.now()),
				})}
				layout="compact"
			>
				<DateTimeSettingsPanel />
			</SettingsSection>
			<SectionDivider />
			<SettingsSection
				icon={PaletteRound}
				title={t("me.section.theme")}
				description={t("theme.description")}
				layout="stack"
			>
				<ThemeSettingsPanel />
			</SettingsSection>
			<SectionDivider />
			<SettingsSection
				icon={Text}
				title={t("me.section.font")}
				description={t("font.description")}
				layout="stack"
			>
				<FontSettingsPanel />
			</SettingsSection>
		</SettingsSheet>
	)
}
