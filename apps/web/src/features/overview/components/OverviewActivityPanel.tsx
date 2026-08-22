import type { SortBy } from "@hoardodile/shared"
import { SectionTabs } from "@hoardodile/ui/components/section-tabs"
import { Pulse } from "@hoardodile/ui/icons/registry"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
	RecentCharactersStrip,
	useRecentCharactersCount,
} from "../sections/RecentCharactersStrip"
import {
	RecentCommentsSection,
	useRecentCommentsCount,
} from "../sections/RecentCommentsSection"
import {
	RecentDocumentsSection,
	useRecentDocumentsCount,
} from "../sections/RecentDocumentsSection"
import {
	RecentResourcesStrip,
	useRecentResourcesCount,
} from "../sections/RecentResourcesStrip"
import { OverviewSectionCard } from "./OverviewSectionCard"
import { SectionSortToggle } from "./SectionSortToggle"
import { SectionTitle } from "./SectionTitle"

/**
 * Borderless activity section: per-entity recent-activity tabs, separated
 * from neighboring sections by whitespace instead of a card surface. The tab
 * bar: uppercase 12px labels, 2px active underline, and a
 * 2px strong bottom edge; the created/updated pill tabs share the tab row —
 * every entity can be sorted except messages, so they hide on that tab. The
 * "View all" link for the active tab lives on the section header's right.
 */
export function OverviewActivityPanel() {
	const { t } = useTranslation()
	const [activeTab, setActiveTab] = useState("resources")
	const [sortBy, setSortBy] = useState<SortBy>("updated")

	const showSort = activeTab !== "comments"

	const resourcesCount = useRecentResourcesCount(sortBy)
	const charactersCount = useRecentCharactersCount(sortBy)
	const documentsCount = useRecentDocumentsCount(sortBy)
	const commentsCount = useRecentCommentsCount()

	const activeCount =
		activeTab === "resources"
			? resourcesCount
			: activeTab === "characters"
				? charactersCount
				: activeTab === "documents"
					? documentsCount
					: commentsCount

	const viewAll =
		activeTab === "documents" ? (
			<Link
				to="/documents"
				search={{ sortBy, order: "desc" }}
				className="text-xs text-muted-foreground transition-colors hover:text-secondary-foreground"
			>
				{t("overview.viewAll")}
			</Link>
		) : (
			<Link
				to={
					activeTab === "resources"
						? "/resources"
						: activeTab === "characters"
							? "/characters"
							: "/messages"
				}
				className="text-xs text-muted-foreground transition-colors hover:text-secondary-foreground"
			>
				{t("overview.viewAll")}
			</Link>
		)

	return (
		<OverviewSectionCard
			title={
				<SectionTitle
					icon={Pulse}
					title={t("overview.activity.title")}
					count={activeCount}
				/>
			}
			action={viewAll}
			data-testid="overview-activity-panel"
		>
			<SectionTabs
				value={activeTab}
				onChange={setActiveTab}
				controls={
					showSort ? (
						<SectionSortToggle
							sortBy={sortBy}
							onChange={setSortBy}
							testId="overview-activity-sort"
						/>
					) : null
				}
				items={[
					{
						value: "resources",
						label: t("overview.stats.resources"),
						panel: <RecentResourcesStrip sortBy={sortBy} />,
					},
					{
						value: "characters",
						label: t("overview.stats.characters"),
						panel: <RecentCharactersStrip sortBy={sortBy} />,
					},
					{
						value: "documents",
						label: t("overview.stats.documents"),
						panel: <RecentDocumentsSection mode="list" sortBy={sortBy} />,
					},
					{
						value: "comments",
						label: t("overview.stats.messages"),
						panel: <RecentCommentsSection mode="list" />,
					},
				]}
			/>
		</OverviewSectionCard>
	)
}
