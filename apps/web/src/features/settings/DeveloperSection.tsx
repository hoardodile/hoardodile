import { User } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { ExternalLink } from "@/components/common/ExternalLink"
import { APP_DEVELOPER_NAME, APP_DEVELOPER_URL } from "@/lib/appInfo"
import { SettingsSection } from "./SettingsSection"

/**
 * Developer block on the Settings → About tab: who builds hoardodile,
 * linking out to the maintainer's GitHub profile.
 */
export function DeveloperSection() {
	const { t } = useTranslation()
	return (
		<SettingsSection
			icon={User}
			title={t("me.about.developerTitle")}
			description={t("me.about.developerRole")}
			layout="stack"
			data-testid="me-section-developer"
		>
			<div className="flex flex-wrap items-center gap-x-6 gap-y-2">
				<span className="text-ui font-medium text-foreground">
					{APP_DEVELOPER_NAME}
				</span>
				<ExternalLink
					href={APP_DEVELOPER_URL}
					data-testid="me-developer-profile"
					className="text-xs text-primary underline-offset-4 hover:underline"
				>
					{t("me.about.developerProfile")}
				</ExternalLink>
			</div>
		</SettingsSection>
	)
}
