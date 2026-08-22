import { User } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { charListCardsQueryOptions } from "@/features/char/api"
import { StatCard } from "../components/StatCard"

const RECENT_CHARACTERS_SIZE = 5

/**
 * Characters summary stat — one of the four hero count links.
 * The activity panel renders its own card strip
 * ({@link RecentCharactersStrip}) instead of this section's list mode.
 */
export function RecentCharactersSection() {
	const { t } = useTranslation()

	const { data } = useQuery(
		charListCardsQueryOptions({
			query: "",
			page: 1,
			size: RECENT_CHARACTERS_SIZE,
			sortBy: "updated",
			order: "desc",
		}),
	)

	return (
		<StatCard
			to="/characters"
			icon={User}
			count={data?.total ?? 0}
			label={t("overview.stats.characters")}
			testId="overview-stat-characters"
			variant="plain"
		/>
	)
}
