import { Gallery } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { resListCardsQueryOptions } from "@/features/res/api"
import { StatCard } from "../components/StatCard"

const RECENT_RESOURCES_SIZE = 5

/**
 * Resources summary stat — one of the four hero count links.
 * The activity panel renders its own card strip
 * ({@link RecentResourcesStrip}) instead of this section's list mode.
 */
export function RecentResourcesSection() {
	const { t } = useTranslation()

	const { data } = useQuery(
		resListCardsQueryOptions({
			query: "",
			page: 1,
			size: RECENT_RESOURCES_SIZE,
			sortBy: "updated",
			order: "desc",
		}),
	)

	return (
		<StatCard
			to="/resources"
			icon={Gallery}
			count={data?.total ?? 0}
			label={t("overview.stats.resources")}
			testId="overview-stat-resources"
			variant="plain"
		/>
	)
}
