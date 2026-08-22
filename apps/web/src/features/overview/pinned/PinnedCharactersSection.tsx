import { Icon } from "@hoardodile/ui/components/icon"
import { SectionTabs } from "@hoardodile/ui/components/section-tabs"
import { Pin, Refresh } from "@hoardodile/ui/icons/registry"
import type { UseQueryResult } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type RefObject, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { CharCardListResult } from "@/features/char/api"
import { CharCard } from "@/features/char/components/CharCard"
import { CharCardSkeleton } from "@/features/char/components/CharCardSkeleton"
import {
	Marquee,
	MarqueeChevrons,
	type MarqueeHandle,
} from "../components/Marquee"
import { OverviewSectionCard } from "../components/OverviewSectionCard"
import { SectionTitle } from "../components/SectionTitle"
import { PinnedSectionSkeleton } from "./PinnedSectionSkeleton"
import type { PinnedSectionItem } from "./types"
import { DEFAULT_PINNED_SIZE } from "./types"
import { usePinnedSectionRefresh } from "./useOverviewPinnedData"
import type { PinnedCharacterItemData } from "./usePinnedSectionData"

function PinnedCharacterContent({
	item,
	query,
	forceSkeleton = false,
	stripRef,
}: {
	readonly item: PinnedSectionItem
	readonly query: UseQueryResult<CharCardListResult, Error>
	readonly forceSkeleton?: boolean
	readonly stripRef?: RefObject<MarqueeHandle | null>
}) {
	const { t } = useTranslation()

	const showSkeleton = query.isPending || forceSkeleton
	const rows = query.data?.rows ?? []
	const isEmpty = !showSkeleton && rows.length === 0

	return (
		<div className="min-w-0">
			{showSkeleton ? (
				<div
					className="flex w-fit max-w-full gap-4 no-scrollbar overflow-x-auto pb-2"
					data-testid="pinned-section-content-skeleton"
				>
					{Array.from({ length: item.size ?? DEFAULT_PINNED_SIZE }).map(
						(_, i) => (
							<div key={i} className="shrink-0">
								<CharCardSkeleton />
							</div>
						),
					)}
				</div>
			) : isEmpty ? (
				<p className="text-sm text-muted-foreground">
					{t("overview.pinned.charactersEmpty")}
				</p>
			) : (
				<Marquee ref={stripRef}>
					{rows.map((character) => (
						<CharCard
							key={character.id}
							character={character}
							className="shrink-0"
						/>
					))}
				</Marquee>
			)}
		</div>
	)
}

export function PinnedCharactersSection({
	visibleItems,
	isPending,
}: {
	readonly visibleItems: PinnedCharacterItemData[]
	readonly isPending: boolean
}) {
	const { t } = useTranslation()
	const { refreshingId, refresh } = usePinnedSectionRefresh(visibleItems)
	const stripRef = useRef<MarqueeHandle>(null)

	const [activeId, setActiveId] = useState<string | undefined>(
		visibleItems[0]?.item.id,
	)
	useEffect(() => {
		setActiveId((prev) => {
			const found = visibleItems.find(({ item }) => item.id === prev)
			return found?.item.id ?? visibleItems[0]?.item.id
		})
	}, [visibleItems])

	if (isPending) {
		return (
			<PinnedSectionSkeleton data-testid="overview-pinned-characters-loading">
				<div className="mx-auto flex w-fit max-w-full gap-4 no-scrollbar overflow-x-auto pb-2">
					{Array.from({ length: DEFAULT_PINNED_SIZE }).map((_, i) => (
						<div key={i} className="shrink-0">
							<CharCardSkeleton />
						</div>
					))}
				</div>
			</PinnedSectionSkeleton>
		)
	}

	if (visibleItems.length === 0) return null

	const isSingle = visibleItems.length === 1
	const activeEntry =
		visibleItems.find(({ item }) => item.id === activeId) ?? visibleItems[0]
	if (activeEntry === undefined) return null

	const sectionTitle = isSingle
		? (activeEntry.item.title ?? t("overview.pinned.charactersTitle"))
		: t("overview.pinned.charactersTitle")

	const viewAllSearch = {
		query: activeEntry.item.query,
		tagIds: activeEntry.item.tagIds ? [...activeEntry.item.tagIds] : undefined,
		tagMode: activeEntry.item.tagMode,
		sortBy: activeEntry.item.sortBy,
		order: activeEntry.item.order,
		random: activeEntry.item.random,
		traitFilters: activeEntry.item.traitFilters
			? [...activeEntry.item.traitFilters]
			: undefined,
		searchIntro: activeEntry.item.searchIntro,
		relationshipTypeIds: activeEntry.item.relationshipTypeIds
			? [...activeEntry.item.relationshipTypeIds]
			: undefined,
	}

	return (
		<OverviewSectionCard
			className="min-w-0"
			title={
				<SectionTitle
					icon={Pin}
					title={sectionTitle}
					count={activeEntry.query.data?.rows.length}
					controls={<MarqueeChevrons stripRef={stripRef} />}
				/>
			}
			action={
				<div className="flex items-center gap-4">
					<button
						type="button"
						onClick={() => refresh(activeEntry.item, "character")}
						disabled={refreshingId === activeEntry.item.id}
						aria-label={t("overview.pinned.refreshSectionAria", {
							title: sectionTitle,
						})}
						data-testid="pinned-section-refresh"
						className="text-muted-foreground transition-colors hover:text-secondary-foreground disabled:pointer-events-none disabled:opacity-50"
					>
						<Icon
							icon={Refresh}
							className="size-4 text-muted-foreground transition-colors hover:text-secondary-foreground disabled:pointer-events-none disabled:opacity-50"
						/>
					</button>
					<Link
						to="/characters"
						search={viewAllSearch}
						className="text-xs text-muted-foreground transition-colors hover:text-secondary-foreground"
					>
						{t("overview.viewAll")}
					</Link>
				</div>
			}
			data-testid="overview-pinned-characters"
		>
			{isSingle ? (
				<PinnedCharacterContent
					item={activeEntry.item}
					query={activeEntry.query}
					forceSkeleton={refreshingId === activeEntry.item.id}
					stripRef={stripRef}
				/>
			) : (
				<SectionTabs
					value={activeEntry.item.id}
					onChange={setActiveId}
					items={visibleItems.map(({ item, query }) => ({
						value: item.id,
						label: item.title ?? t("overview.pinned.charactersTitle"),
						panel: (
							<PinnedCharacterContent
								item={item}
								query={query}
								forceSkeleton={refreshingId === item.id}
								stripRef={
									item.id === activeEntry.item.id ? stripRef : undefined
								}
							/>
						),
					}))}
				/>
			)}
		</OverviewSectionCard>
	)
}
