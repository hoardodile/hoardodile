import type { CharCard as CharCardData } from "@hoardodile/schemas"
import { FilterRailSection } from "@hoardodile/ui/components/filter-rail"
import { PageScaffold } from "@hoardodile/ui/components/page-scaffold"
import { MenuDots } from "@hoardodile/ui/icons/registry"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Outlet } from "@tanstack/react-router"
import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
	DetailPanel,
	DetailPanelTrigger,
} from "@/components/layout/DetailPanel"
import { useCategoryList } from "@/features/cat"
import { charDetailCardQueryOptions, charKeys } from "@/features/char"
import { CharCard, CharCardActions } from "@/features/char/components/CharCard"
import { CharImagePreviewDialog } from "@/features/char/components/CharImagePreviewDialog"
import { useCharImageExists } from "@/features/char/hooks/useCharImageExists"
import { useDateFormatter } from "@/features/settings/datePrefs"
import { buildTagGroups, tagsForCharacterQueryOptions } from "@/features/tags"
import { CatTagGroups } from "@/features/tags/CatTagGroups"
import { TagChipLink } from "@/features/tags/TagChipLink"
import {
	buildTraitRows,
	formatTraitValue,
	traitListQueryOptions,
} from "@/features/traits"
import { EntityUsageStats } from "@/features/usage/components/EntityUsageStats"
import { useUsageTracker } from "@/features/usage/useUsageTracker"
import { requireAuth } from "@/lib/auth-guard"
import { apiPaths } from "@/lib/paths"
import {
	CHAR_CARD_TRANSITION,
	useSharedElementHero,
} from "@/lib/sharedElementTransition"

export const Route = createFileRoute("/characters/$id")({
	beforeLoad: requireAuth,
	component: CharDetailLayout,
})

/**
 * Character detail layout. Mirrors the structure of `/resources/$id`:
 * the right sidebar (fullbody illustration, traits, tag groups) is owned
 * by the layout and persists across tabs, while the main column holds
 * the per-tab content via {@link Outlet}. The header reuses
 * {@link CharCard} for avatar + actions.
 *
 * The sidebar rides the AppShell's right panel column (w-panel — the
 * same column the search pages' filter rails use) at and above the
 * panel breakpoint, and a right drawer below it. Tag groups, trait
 * values, and the fullbody illustration intentionally live outside the
 * overview tab so navigating to the resources tab keeps the sidebar
 * context visible.
 */
function CharDetailLayout() {
	const { id } = Route.useParams()
	useUsageTracker({ entityType: "character", entityId: id })
	const { t } = useTranslation()
	const detail = useQuery(charDetailCardQueryOptions(id))
	const qc = useQueryClient()
	const [preview, setPreview] = useState<{
		open: boolean
		variant: "avatar" | "fullbody"
	}>({ open: false, variant: "avatar" })
	const heroRef = useRef<HTMLDivElement | null>(null)
	useSharedElementHero(heroRef, CHAR_CARD_TRANSITION)

	// The grid already rendered the very same card — reuse its cached row
	// as a placeholder so the header card exists in the transition's first
	// snapshot (the grid → detail shared-element morph); the detail query
	// then upgrades it in place.
	const cachedRow = useMemo(() => {
		if (detail.data !== undefined) return undefined
		const hits = qc.getQueriesData<{ rows?: readonly CharCardData[] }>({
			queryKey: [...charKeys.all, "listCards"],
		})
		for (const [, data] of hits) {
			const row = data?.rows?.find((r) => r.id === id)
			if (row !== undefined) return row
		}
		return undefined
	}, [qc, id, detail.data])

	// Show stale data while a refetch is in flight or has transiently failed.
	// Only fall back to loading/error placeholders when no data has ever arrived,
	// otherwise a transient error during tab switches (TanStack Router cancels
	// in-flight queries on navigation, surfacing AbortError once with retry: false)
	// would unmount the entire detail page until a hard refresh.
	const c = detail.data ?? cachedRow
	if (c === undefined) {
		if (detail.isError) {
			return (
				<div className="p-6 text-sm text-destructive">
					{t("characters.detail.loadError")}
				</div>
			)
		}
		return (
			<div className="p-6 text-sm text-muted-foreground">
				{t("common.loading")}
			</div>
		)
	}

	const intro = detail.data?.intro ?? ""
	const phrases = intro.split("\n")

	const sidebar = (
		<CharSidebar
			char={c}
			onFullbodyClick={() => setPreview({ open: true, variant: "fullbody" })}
		/>
	)

	return (
		<PageScaffold width="medium">
			<header className="flex items-start gap-6">
				{/* The hero's left block is the character card itself — it
				    already carries the avatar (click → preview), the name,
				    the actions menu, pinned traits/tags and relationships.
				    The wrapper is the shared-element transition's hero
				    (grid card → detail card). */}
				<div ref={heroRef} className="shrink-0">
					<CharCard
						character={c}
						onAvatarClick={() => setPreview({ open: true, variant: "avatar" })}
					/>
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-start justify-between gap-4">
						<h1
							className="text-doc-heading font-bold text-foreground"
							data-testid="character-detail-name"
						>
							{c.name}
						</h1>
						<div className="flex shrink-0 items-center gap-2 pt-1">
							{/* The drawer trigger, at home beside the More menu
							    (hidden once the panel column takes over). */}
							<DetailPanel
								fabLabel={t("characters.detail.openSidebar")}
								fabTestId="character-detail-sidebar-fab"
								trigger={(open) => (
									<DetailPanelTrigger
										label={t("characters.detail.openSidebar")}
										testId="character-detail-sidebar-fab"
										onOpen={open}
									/>
								)}
							>
								{sidebar}
							</DetailPanel>
							<CharCardActions
								character={c}
								renderTrigger={() => (
									<button
										type="button"
										title={t("me.custom.more")}
										aria-label={t("me.custom.more")}
										className="flex size-8 items-center justify-center rounded-lg text-secondary-foreground hover:bg-muted"
										data-testid="character-detail-more"
									>
										<MenuDots className="size-4" strokeWidth={1.6} />
									</button>
								)}
							/>
						</div>
					</div>
					<EntityUsageStats
						entityType="character"
						entityId={id}
						className="mt-2"
					/>
					{detail.data !== undefined ? (
						<div className="mt-3 flex flex-col gap-2">
							{intro.length === 0 ? (
								<p className="text-ui leading-[1.75] text-muted-foreground">
									{t("characters.detail.noIntro")}
								</p>
							) : (
								phrases.map((phrase, i) =>
									phrase.length > 0 ? (
										<p
											key={i}
											className="text-ui leading-[1.75] text-secondary-foreground whitespace-pre-wrap"
										>
											{phrase}
										</p>
									) : (
										<div key={i} className="h-2" />
									),
								)
							)}
						</div>
					) : null}
				</div>
			</header>
			<div className="mt-8 flex min-w-0 flex-col gap-4">
				<Outlet />
			</div>
			<CharImagePreviewDialog
				open={preview.open}
				charId={c.id}
				charName={c.name}
				variant={preview.variant}
				updatedAt={c.updatedAt}
				onOpenChange={(open) => setPreview((prev) => ({ ...prev, open }))}
			/>
		</PageScaffold>
	)
}

type FullbodySectionProps = {
	readonly charId: string
	readonly name: string
	readonly updatedAt: number
	readonly onClick?: () => void
}

function FullbodySection(props: FullbodySectionProps) {
	const { charId, name, updatedAt, onClick } = props
	return (
		<div data-testid="character-detail-fullbody">
			{/* Panel geometry — but the whole art, uncropped: natural
			    aspect capped at the panel width and a reference height. */}
			<button
				type="button"
				onClick={onClick}
				className="block w-full cursor-pointer"
				disabled={onClick === undefined}
			>
				<img
					src={`${apiPaths.characters.image(charId, "fullbody")}?v=${updatedAt}`}
					alt={name}
					className="mx-auto max-h-130 w-auto max-w-full rounded-xl"
				/>
			</button>
		</div>
	)
}

function TraitsSection({ charId }: { readonly charId: string }) {
	const { formatDateTrait } = useDateFormatter()
	const detail = useQuery(charDetailCardQueryOptions(charId))
	const traitsQ = useQuery(traitListQueryOptions())
	const rows = buildTraitRows(
		traitsQ.data ?? [],
		detail.data?.traitValues ?? {},
	)
	if (rows.length === 0) return null
	return (
		<dl
			className="flex flex-col gap-1.5 text-sm"
			data-testid="character-detail-traits"
		>
			{rows.map((row) => (
				<div
					key={row.traitId}
					className="flex flex-wrap items-baseline gap-x-2"
					data-testid={`character-detail-trait-${row.traitId}`}
				>
					<dt className="shrink-0">
						<TagChipLink
							id={row.traitId}
							type="character"
							name={row.name}
							color={row.color}
							size="md"
							link={false}
						/>
					</dt>
					{/* The facet-row colon, the same as the tag groups. */}
					<span className="shrink-0 text-xs text-muted-foreground">: </span>
					<dd className="wrap-break-word">
						{formatTraitValue(row, formatDateTrait)}
					</dd>
				</div>
			))}
		</dl>
	)
}

function TagsSection({ charId }: { readonly charId: string }) {
	const tagsQ = useQuery(tagsForCharacterQueryOptions(charId))
	const categories = useCategoryList()
	const groups = buildTagGroups(tagsQ.data ?? [], categories)
	if (groups.length === 0) return null
	return (
		<div data-testid="character-detail-tags">
			<CatTagGroups
				type="character"
				groups={groups}
				categoryVariant="chip"
				testIdPrefix="character-detail-tag-group"
			/>
		</div>
	)
}

type CharSidebarProps = {
	readonly char: CharCardData
	readonly onFullbodyClick: () => void
}

/** The 320px right panel — the search rails' section anatomy (2px seams,
    uppercase labels), the first section carrying the art unlabeled. The
    section vanishes entirely when the character has no fullbody art, so
    the seam under it goes with it. */
function CharSidebar({ char, onFullbodyClick }: CharSidebarProps) {
	const { t } = useTranslation()
	const hasFullbody = useCharImageExists(char.id, "fullbody")
	return (
		<div className="flex h-full w-full flex-col overflow-y-auto px-5 pb-5">
			{hasFullbody === true ? (
				<FilterRailSection>
					<FullbodySection
						charId={char.id}
						name={char.name}
						updatedAt={char.updatedAt}
						onClick={onFullbodyClick}
					/>
				</FilterRailSection>
			) : null}
			<FilterRailSection label={t("characters.detail.traits")}>
				<TraitsSection charId={char.id} />
			</FilterRailSection>
			<FilterRailSection label={t("characters.detail.tags")}>
				<TagsSection charId={char.id} />
			</FilterRailSection>
		</div>
	)
}
