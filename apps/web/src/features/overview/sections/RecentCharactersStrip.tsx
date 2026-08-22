import type { SortBy } from "@hoardodile/shared"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { charListCardsQueryOptions } from "@/features/char/api"
import { CharCard } from "@/features/char/components/CharCard"
import { CharCardSkeleton } from "@/features/char/components/CharCardSkeleton"
import { Marquee } from "../components/Marquee"

const RECENT_CHARACTERS_SIZE = 8

/**
 * How many characters the recent-characters tab currently displays, fetched
 * through the tab's own query options so both share one cache entry.
 */
export function useRecentCharactersCount(sortBy: SortBy): number | undefined {
	const { data } = useQuery(
		charListCardsQueryOptions({
			query: "",
			page: 1,
			size: RECENT_CHARACTERS_SIZE,
			sortBy,
			order: "desc",
		}),
	)
	return data?.rows.length
}

/**
 * Recent-activity characters tab: the same card strip as the pinned
 * characters row. Sorts by `sortBy`, which the section header's pill tabs
 * own.
 */
export function RecentCharactersStrip({ sortBy }: { readonly sortBy: SortBy }) {
	const { t } = useTranslation()
	const { data, isPending } = useQuery(
		charListCardsQueryOptions({
			query: "",
			page: 1,
			size: RECENT_CHARACTERS_SIZE,
			sortBy,
			order: "desc",
		}),
	)

	if (isPending || data === undefined) {
		return (
			<div
				className="flex w-fit max-w-full gap-4 overflow-x-auto pb-2 no-scrollbar"
				data-testid="overview-activity-characters"
			>
				{Array.from({ length: RECENT_CHARACTERS_SIZE }).map((_, i) => (
					<div key={i} className="shrink-0">
						<CharCardSkeleton />
					</div>
				))}
			</div>
		)
	}

	if (data.rows.length === 0) {
		return (
			<p className="text-[13px] text-muted-foreground">
				{t("overview.empty.characters")}
			</p>
		)
	}

	return (
		<div data-testid="overview-activity-characters">
			<Marquee>
				{data.rows.map((character) => (
					<CharCard
						key={character.id}
						character={character}
						className="shrink-0"
					/>
				))}
			</Marquee>
		</div>
	)
}
