import type { IconType } from "@hoardodile/ui/components/icon"
import { IconTile } from "@hoardodile/ui/components/icon-tile"
import { Surface } from "@hoardodile/ui/components/surface"
import {
	AltArrowRight,
	Bug,
	ChatRoundDots,
	Rocket,
} from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { ExternalLink } from "@/components/common/ExternalLink"
import { APP_ISSUES_BUG_URL, APP_ISSUES_FEATURE_URL } from "@/lib/appInfo"
import { SettingsSection } from "./SettingsSection"

/**
 * Feedback block on the Settings → About tab: report a bug or request a
 * feature — one card per destination, straight into the repo's issue
 * templates.
 */
export function FeedbackSection() {
	const { t } = useTranslation()
	return (
		<SettingsSection
			icon={ChatRoundDots}
			title={t("me.about.feedbackTitle")}
			description={t("me.about.feedbackDescription")}
			layout="stack"
			data-testid="me-section-feedback"
		>
			<div className="grid gap-3 md:grid-cols-2">
				<FeedbackCard
					icon={Bug}
					title={t("me.about.bugTitle")}
					description={t("me.about.bugDescription")}
					href={APP_ISSUES_BUG_URL}
					testId="me-feedback-bug"
				/>
				<FeedbackCard
					icon={Rocket}
					title={t("me.about.featureTitle")}
					description={t("me.about.featureDescription")}
					href={APP_ISSUES_FEATURE_URL}
					testId="me-feedback-feature"
				/>
			</div>
		</SettingsSection>
	)
}

type FeedbackCardProps = {
	readonly icon: IconType
	readonly title: string
	readonly description: string
	readonly href: string
	readonly testId: string
}

function FeedbackCard(props: FeedbackCardProps) {
	return (
		<ExternalLink
			href={props.href}
			data-testid={props.testId}
			className="group block"
		>
			<Surface className="flex h-full items-center gap-3 transition-colors hover:bg-accent/50">
				<IconTile icon={props.icon} />
				<div className="min-w-0 flex-1">
					<div className="text-ui font-medium text-foreground">
						{props.title}
					</div>
					<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
						{props.description}
					</p>
				</div>
				<AltArrowRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
			</Surface>
		</ExternalLink>
	)
}
