import type { IconType } from "@hoardodile/ui/components/icon"
import { SectionTabs } from "@hoardodile/ui/components/section-tabs"
import {
	BranchingPathsUp,
	Layers,
	Share,
	Tag,
	UserId,
} from "@hoardodile/ui/icons/registry"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CatsAndTagsPanel } from "@/features/cat/CatsAndTagsPanel"
import { RelationshipTypesMePanel } from "@/features/char/components/RelationshipTypesMePanel"
import { ColManagementPanel } from "@/features/col/ColManagementPanel"
import { SettingsSection } from "@/features/settings/SettingsSection"
import {
	SectionDivider,
	SettingsSheet,
} from "@/features/settings/SettingsSheet"
import { TagRulesSection } from "@/features/tags/TagRulesSection"
import { TraitManagementPanel } from "@/features/traits/TraitManagementPanel"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings/custom")({
	beforeLoad: requireAuth,
	component: CustomSettingsRoute,
})

type CustomTab = "tags" | "traits" | "relationships" | "collections"

type TabDef = {
	readonly id: CustomTab
	readonly icon: IconType
	readonly testId: string
}

const TABS: readonly TabDef[] = [
	{ id: "tags", icon: Tag, testId: "custom-tab-tags" },
	{ id: "traits", icon: UserId, testId: "custom-tab-traits" },
	{ id: "relationships", icon: Share, testId: "custom-tab-relationships" },
	{ id: "collections", icon: Layers, testId: "custom-tab-collections" },
]

/**
 * Custom settings tab — the taxonomy console. The tab row is the
 * generic section-mode tab list; the active tab opens as a settings
 * block with the standard section header (icon tile + title +
 * description). The Tags tab carries the tag rules block underneath.
 */
function CustomSettingsRoute() {
	const { t } = useTranslation()
	const [tab, setTab] = useState<CustomTab>("tags")
	const active = TABS.find((tabDef) => tabDef.id === tab) ?? TABS[0]!

	return (
		<>
			<SectionTabs
				value={tab}
				onChange={setTab}
				className="mb-6"
				items={TABS.map((tabDef) => ({
					value: tabDef.id,
					label: t(`me.custom.tab.${tabDef.id}`),
					testId: tabDef.testId,
				}))}
			/>
			<SettingsSheet>
				<SettingsSection
					icon={active.icon}
					title={t(`me.custom.tab.${active.id}`)}
					description={t(`me.custom.blurb.${active.id}`)}
					layout="stack"
				>
					{tab === "tags" ? (
						<>
							<CatsAndTagsPanel />
							<SectionDivider />
							<SettingsSection
								icon={BranchingPathsUp}
								title={t("me.section.tagRules")}
								description={t("tags.rules.description")}
								layout="stack"
								data-testid="me-tag-rules"
							>
								<TagRulesSection />
							</SettingsSection>
						</>
					) : tab === "traits" ? (
						<TraitManagementPanel />
					) : tab === "relationships" ? (
						<RelationshipTypesMePanel />
					) : (
						<ColManagementPanel />
					)}
				</SettingsSection>
			</SettingsSheet>
		</>
	)
}
