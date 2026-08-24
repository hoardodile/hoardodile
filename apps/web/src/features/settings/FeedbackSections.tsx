import { buttonVariants } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Bug, Rocket } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { ExternalLink } from "@/components/common/ExternalLink"
import { APP_ISSUES_BUG_URL, APP_ISSUES_FEATURE_URL } from "@/lib/appInfo"
import { SettingsSection } from "./SettingsSection"

/**
 * Feedback blocks on the Settings → About tab — one section per
 * destination, each leading straight into the repo's issue template.
 */
export function BugReportSection() {
	const { t } = useTranslation()
	return (
		<SettingsSection
			icon={Bug}
			title={t("me.about.bugTitle")}
			description={t("me.about.bugDescription")}
			layout="compact"
			data-testid="me-section-bug"
		>
			<ExternalLink
				href={APP_ISSUES_BUG_URL}
				data-testid="me-feedback-bug"
				className={buttonVariants({ variant: "secondary" })}
			>
				<Icon icon={Bug} />
				{t("me.about.bugAction")}
			</ExternalLink>
		</SettingsSection>
	)
}

export function FeatureRequestSection() {
	const { t } = useTranslation()
	return (
		<SettingsSection
			icon={Rocket}
			title={t("me.about.featureTitle")}
			description={t("me.about.featureDescription")}
			layout="compact"
			data-testid="me-section-feature"
		>
			<ExternalLink
				href={APP_ISSUES_FEATURE_URL}
				data-testid="me-feedback-feature"
				className={buttonVariants({ variant: "secondary" })}
			>
				<Icon icon={Rocket} />
				{t("me.about.featureAction")}
			</ExternalLink>
		</SettingsSection>
	)
}
