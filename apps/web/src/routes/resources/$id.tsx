import type { ResAnchor, ResCard as ResCardData } from "@hoardodile/schemas"
import { Button } from "@hoardodile/ui/components/button"
import { FilterRailSection } from "@hoardodile/ui/components/filter-rail"
import { PageScaffold } from "@hoardodile/ui/components/page-scaffold"
import { SectionLabel } from "@hoardodile/ui/components/section-label"
import { Link, Maximize, MenuDots } from "@hoardodile/ui/icons/registry"
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { ExternalLink } from "@/components/common/ExternalLink"
import {
	DetailPanel,
	DetailPanelTrigger,
} from "@/components/layout/DetailPanel"
import { catListQueryOptions } from "@/features/cat"
import { CharChip } from "@/features/char/components/CharChip"
import {
	colResourceIdsQueryOptions,
	colsForResourceQueryOptions,
} from "@/features/col"
import { ResCollectionChips } from "@/features/col/ResColChips"
import { CommentsSection } from "@/features/comments"
import { AnchorJumpProvider } from "@/features/comments/anchor"
import { LinkedDocumentsSection } from "@/features/doc/components/LinkedDocumentsSection"
import {
	pluginListAllQueryOptions,
	resolveManifestName,
} from "@/features/plugin"
import { pushAnchorJump } from "@/features/plugin/iframe/pushes"
import {
	resolvePreviewSizing,
	usePluginManifestUi,
} from "@/features/plugin/preview-sizing"
import {
	duplicateImagesQueryOptions,
	PreviewContent,
	ResCard,
	relatedResourcesByTagsQueryOptions,
	resDetailCardQueryOptions,
	resKeys,
	similarImagesQueryOptions,
	similarWithinQueryOptions,
	useContainerFullscreen,
	withScheme,
} from "@/features/res"
import {
	bestMatchSimilarity,
	type MatchFile,
	MatchThumbStrip,
} from "@/features/res/components/MatchThumbStrip"
import { ResCardActions } from "@/features/res/components/ResCardActions"
import { ResourceRow } from "@/features/res/components/ResourceRow"
import {
	useDateFormatter,
	useResolvedTimeZone,
} from "@/features/settings/datePrefs"
import { buildTagGroups, tagsForResourceQueryOptions } from "@/features/tags"
import { CatTagGroups } from "@/features/tags/CatTagGroups"
import { TagChip } from "@/features/tags/TagChip"
import { TagChipLink } from "@/features/tags/TagChipLink"
import { EntityUsageStats } from "@/features/usage/components/EntityUsageStats"
import { useUsageTracker } from "@/features/usage/useUsageTracker"
import { requireAuth } from "@/lib/auth-guard"
import { formatBytes } from "@/lib/formatBytes"
import {
	RES_CARD_TRANSITION,
	useSharedElementHero,
} from "@/lib/sharedElementTransition"
import { dayjsFor, getCalendarMonthDay } from "@/lib/timezone"

/** The panel column's solid width (w-panel), minus the per-section
    `px-5` — cards sized against the remaining width. The similarity
    rail shares the same measure for consistency. */
const PANEL_CONTENT_WIDTH_PX = 280

const resDetailSearchSchema = z
	.object({
		/**
		 * 1-based index of the resource file currently being viewed. Persisted
		 * in the URL so refreshing or sharing keeps the same page open.
		 */
		file: z.coerce.number().int().min(1).optional(),
		/**
		 * Source filename target when arriving via a comment anchor jump.
		 * Resolved against the resource's file list to pick the matching
		 * page; falls back silently when the filename is missing from the
		 * resource (e.g. file renamed/removed).
		 */
		fileName: z.string().min(1).optional(),
		/**
		 * Opaque plugin state persisted across navigation (e.g. anchor jump
		 * coordinates, reader scroll position). Interpreted by the plugin's
		 * render module.
		 */
		pluginState: z.string().optional(),
	})
	.loose()

export const Route = createFileRoute("/resources/$id")({
	beforeLoad: requireAuth,
	validateSearch: resDetailSearchSchema,
	component: ResDetailRoute,
})

/**
 * Standalone detail page for a single resource. The preview stage is
 * the hero — media is the content — with the title, file facts, and
 * usage meta above it, the pinned tags / intro / linked entities below,
 * and comments at the bottom of the column beside the hash-relation
 * rail. The right panel (canonical cover, tags, collection siblings,
 * related by tags) rides the AppShell's panel column via
 * {@link DetailPanel}.
 *
 * Reuses {@link PreviewContent} for the actual content viewer so the
 * inline preview and the lightbox dialog stay byte-for-byte identical.
 */
function ResDetailRoute() {
	const { id } = Route.useParams()
	const [contentVisible, setContentVisible] = useState(true)
	useUsageTracker({
		entityType: "resource",
		entityId: id,
		active: contentVisible,
	})
	const { t, i18n } = useTranslation()
	const formatter = useDateFormatter()
	const resolvedTimeZone = useResolvedTimeZone()
	const detailQuery = useQuery(resDetailCardQueryOptions(id))
	const qc = useQueryClient()
	const previewIframeRef = useRef<HTMLIFrameElement | null>(null)
	const fullscreenAPI = useContainerFullscreen(previewIframeRef)
	const manifestUi = usePluginManifestUi(detailQuery.data?.contentPluginId)
	const pluginsQuery = useQuery(pluginListAllQueryOptions())
	const heroRef = useRef<HTMLDivElement | null>(null)
	useSharedElementHero(heroRef, RES_CARD_TRANSITION)

	// The grid already rendered the very same card — reuse its cached row
	// as a placeholder so the panel card exists in the transition's first
	// snapshot (the grid → detail shared-element morph); the detail query
	// then upgrades it in place.
	const cachedRow = useMemo(() => {
		if (detailQuery.data !== undefined) return undefined
		const hits = qc.getQueriesData<{ rows?: readonly ResCardData[] }>({
			queryKey: [...resKeys.all, "listCards"],
		})
		for (const [, data] of hits) {
			const row = data?.rows?.find((r) => r.id === id)
			if (row !== undefined) return row
		}
		return undefined
	}, [qc, id, detailQuery.data])

	function handleAnchorJump(anchor: ResAnchor): void {
		if (anchor.resId !== id) {
			const params = new URLSearchParams()
			if (anchor.data !== undefined) {
				params.set(
					"pluginState",
					encodeURIComponent(JSON.stringify(anchor.data)),
				)
			}
			window.location.href = `/resources/${anchor.resId}?${params.toString()}`
			return
		}
		pushAnchorJump(id, { data: anchor.data })
	}

	const resource = detailQuery.data ?? cachedRow
	if (resource === undefined) {
		if (detailQuery.isError) {
			return (
				<div className="p-6 text-sm text-destructive">
					{detailQuery.error?.message ?? t("resources.detail.notFound")}
				</div>
			)
		}
		return (
			<div className="p-6 text-sm text-muted-foreground">
				{t("common.loading")}
			</div>
		)
	}

	// "In the library for N years": today is the resource's archive
	// anniversary when its calendar month-day matches today's (in the
	// user's time zone) and the years difference is at least 1.
	const createdMonthDay = getCalendarMonthDay(
		resource.createdAt,
		resolvedTimeZone,
	)
	const todayMonthDay = getCalendarMonthDay(Date.now(), resolvedTimeZone)
	const yearsInLibrary =
		dayjsFor(Date.now(), resolvedTimeZone).year() -
		dayjsFor(resource.createdAt, resolvedTimeZone).year()
	const isAnniversary =
		yearsInLibrary >= 1 &&
		createdMonthDay.month === todayMonthDay.month &&
		createdMonthDay.day === todayMonthDay.day

	// Preview surface sizing is the plugin's call: a declared aspect ratio
	// wins (capped at 70vh), then a declared fixed height, then the 60vh
	// default.
	const sizing = resolvePreviewSizing(manifestUi, {
		maxHeight: "70vh",
		fallbackHeight: "60vh",
	})

	// The owning plugin leads the pinned tags — it left the sandbox
	// surface for this quiet meta row.
	const owningManifest =
		resource.contentPluginId !== undefined && resource.contentPluginId !== ""
			? pluginsQuery.data?.find((p) => p.id === resource.contentPluginId)
					?.manifest
			: undefined
	const pluginName =
		owningManifest !== undefined
			? resolveManifestName(owningManifest, i18n.language)
			: undefined

	// The 320px right panel — the search rails' section anatomy (2px seams,
	// edge to edge), each section padded on its own, the first carrying the
	// current resource's card. The card wrapper is the shared-element
	// transition's hero (grid card → detail panel card).
	const panel = (
		<div
			className="flex h-full w-full flex-col overflow-y-auto pb-5"
			data-testid="resource-detail-sidebar"
		>
			<FilterRailSection padded>
				<div ref={heroRef}>
					<ResCard resource={resource} thumbFitWidth={PANEL_CONTENT_WIDTH_PX} />
				</div>
			</FilterRailSection>
			<FilterRailSection
				label={t("resources.detail.sidebar.tagsHeading")}
				padded
			>
				<ResTagsSection resId={id} />
			</FilterRailSection>
			<ResCollectionsSection resId={id} />
			<FilterRailSection
				label={t("resources.detail.sidebar.relatedByTagsHeading")}
				padded
			>
				<ResRelatedByTagsSection resId={id} tagIds={resource.tagIds ?? []} />
			</FilterRailSection>
		</div>
	)

	const header = (
		<header className="flex flex-col gap-2">
			<div className="flex items-start justify-between gap-4">
				<h1
					className="wrap-break-word text-doc-heading font-bold text-foreground"
					data-testid="resource-detail-title"
				>
					{resource.name}
				</h1>
				<div className="flex shrink-0 items-center gap-2 pt-1">
					{/* Icon-only on narrow viewports: the header row can't hold
					    the fullscreen label beside the panel trigger and the
					    More menu. */}
					<Button
						type="button"
						variant="secondary"
						size="icon"
						className="size-8"
						onClick={fullscreenAPI.toggle}
						title={t("resources.detail.fullscreen")}
						aria-label={t("resources.detail.fullscreen")}
						data-testid="preview-fullscreen-toggle"
					>
						<Maximize className="size-4" />
					</Button>
					{/* The drawer trigger, at home beside the More menu
					    (hidden once the panel column takes over). */}
					<DetailPanel
						fabLabel={t("resources.detail.openSidebar")}
						fabTestId="resource-detail-sidebar-fab"
						trigger={(open) => (
							<DetailPanelTrigger
								label={t("resources.detail.openSidebar")}
								testId="resource-detail-sidebar-fab"
								onOpen={open}
							/>
						)}
					>
						{panel}
					</DetailPanel>
					<ResCardActions
						resource={resource}
						renderTrigger={() => (
							<button
								type="button"
								title={t("me.custom.more")}
								aria-label={t("me.custom.more")}
								className="flex size-8 items-center justify-center rounded-lg text-secondary-foreground hover:bg-muted"
								data-testid="resource-detail-more"
							>
								<MenuDots className="size-4" strokeWidth={1.6} />
							</button>
						)}
					/>
				</div>
			</div>
			{/* The single meta line: file facts, source, usage. */}
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
				{resource.fileStats?.sizeBytes !== undefined ? (
					<span data-testid="resource-detail-size">
						{formatBytes(resource.fileStats.sizeBytes)}
					</span>
				) : null}
				{resource.fileStats?.count !== undefined ? (
					<span data-testid="resource-detail-file-count">
						{t("resources.detail.fileCount", {
							count: resource.fileStats.count,
						})}
					</span>
				) : null}
				<span>{formatter.formatDateTime(resource.createdAt)}</span>
				{resource.sourceUrl !== undefined ? (
					<ExternalLink
						href={withScheme(resource.sourceUrl)}
						className="inline-flex items-center gap-1 hover:underline"
						data-testid="resource-detail-source"
					>
						<Link className="size-3" />
						{t("resources.detail.sourceFrom", {
							name: resource.sourceName ?? t("resources.source.fallback"),
						})}
					</ExternalLink>
				) : resource.sourceName !== undefined ? (
					<span data-testid="resource-detail-source">
						{t("resources.detail.sourceFrom", {
							name: resource.sourceName,
						})}
					</span>
				) : null}
				{isAnniversary ? (
					<span
						className="font-medium text-foreground/80"
						data-testid="resource-detail-anniversary"
					>
						{t("resources.detail.anniversary", { count: yearsInLibrary })}
					</span>
				) : null}
				<EntityUsageStats entityType="resource" entityId={id} />
			</div>
		</header>
	)

	const previewSurface = (
		<div
			className="relative flex w-full items-center justify-center overflow-hidden"
			style={sizing}
			data-testid="resource-detail-preview"
		>
			<PreviewContent
				resId={id}
				resName={resource.name}
				contentPluginId={resource.contentPluginId ?? ""}
				previewPluginId={resource.previewPluginId}
				sourceMeta={resource.sourceMeta}
				searchMeta={resource.searchMeta}
				fileStats={resource.fileStats}
				iframeRef={previewIframeRef}
				inline
				onContentVisibleChange={setContentVisible}
			/>
		</div>
	)

	const meta = (
		<>
			{pluginName !== undefined || resource.pinnedTags.length > 0 ? (
				<div
					className="flex flex-wrap gap-1.5"
					data-testid="resource-detail-pinned-tags"
				>
					{pluginName !== undefined ? <TagChip>{pluginName}</TagChip> : null}
					{resource.pinnedTags.map((tag) => (
						<TagChipLink
							key={tag.id}
							id={tag.id}
							type="resource"
							name={tag.name}
							color={tag.color}
							virtual={tag.virtual}
							className="max-w-25"
						/>
					))}
				</div>
			) : null}

			{(resource.intro?.length ?? 0) > 0 ? (
				<p className="whitespace-pre-wrap text-sm">{resource.intro}</p>
			) : null}

			{resource.characters.length > 0 ? (
				<div
					className="flex flex-wrap gap-1.5"
					data-testid="resource-detail-characters"
				>
					{resource.characters.map((char) => (
						<CharChip
							key={char.id}
							showName
							charId={char.id}
							character={{ name: char.name, updatedAt: char.updatedAt }}
						/>
					))}
				</div>
			) : null}

			<ResCollectionChips collections={resource.collections} />
		</>
	)

	const commentsSection = (
		<CommentsSection
			variant="embedded"
			context={{ kind: "res", id }}
			testId="resource-detail-comments"
		/>
	)

	return (
		<PageScaffold width="content">
			{header}
			<div className="mt-6">{previewSurface}</div>
			<div className="mt-6 flex flex-col gap-4">
				{meta}
				<LinkedDocumentsSection
					titleKey="resources.detail.docSearchTitle"
					resIds={[id]}
				/>
			</div>
			{/* Messages keep the narrower reading measure; the hash
			    relations take whatever width the messages leave, capped. */}
			<section className="mx-auto mt-10 flex w-full justify-center gap-6">
				<div className="min-w-0 max-w-medium flex-1">
					<AnchorJumpProvider handler={handleAnchorJump}>
						{commentsSection}
					</AnchorJumpProvider>
				</div>
				<aside className="hidden min-w-0 max-w-70 flex-1 flex-col gap-8 lg:flex">
					<ResImageSimilaritySection resId={id} />
				</aside>
			</section>
		</PageScaffold>
	)
}

type ResTagsSectionProps = {
	readonly resId: string
}

/**
 * Every tag the resource owns, grouped by category (not filtered by the
 * pinned flag). Tag chips reuse {@link TagChipLink} so colour blending
 * and navigation behave the same as on cards.
 */
function ResTagsSection(props: ResTagsSectionProps) {
	const { resId } = props
	const { t } = useTranslation()
	const tagsQuery = useQuery(tagsForResourceQueryOptions(resId))
	const catsQuery = useQuery(catListQueryOptions())
	const tags = tagsQuery.data ?? []
	const categories = catsQuery.data ?? []
	const groups = buildTagGroups(tags, categories)
	return groups.length === 0 ? (
		<p className="text-xs text-muted-foreground">
			{t("resources.detail.sidebar.noTags")}
		</p>
	) : (
		<CatTagGroups
			type="resource"
			groups={groups}
			testIdPrefix="resource-detail-tag-group"
		/>
	)
}

type ResCollectionsSectionProps = {
	readonly resId: string
}

/**
 * One panel section per collection the resource belongs to, listing the
 * sibling resources as compact rows. Skips the current resource so the
 * user doesn't see themselves.
 */
function ResCollectionsSection(props: ResCollectionsSectionProps) {
	const { resId } = props
	const colsQuery = useQuery(colsForResourceQueryOptions(resId))
	const collections = colsQuery.data ?? []
	if (collections.length === 0) return null
	return (
		<>
			{collections.map((c) => (
				<FilterRailSection key={c.id} label={c.name} padded>
					<ColResourceRows colId={c.id} currentResourceId={resId} />
				</FilterRailSection>
			))}
		</>
	)
}

type ColResourceRowsProps = {
	readonly colId: string
	readonly currentResourceId: string
}

function ColResourceRows(props: ColResourceRowsProps) {
	const { colId, currentResourceId } = props
	const { t } = useTranslation()
	const idsQuery = useQuery(colResourceIdsQueryOptions(colId))
	const allIds = idsQuery.data ?? []
	const otherIds = allIds.filter((rid) => rid !== currentResourceId)
	// Per-card detail fetch. Cheaper than a dedicated `listCardsByIds`
	// procedure for the sidebar's small handful of items, and reuses
	// the same cache slot as elsewhere on the page.
	const cardQueries = useQueries({
		queries: otherIds.map((rid) => resDetailCardQueryOptions(rid)),
	})
	const cards = cardQueries
		.map((q) => q.data)
		.filter((card): card is NonNullable<typeof card> => card !== undefined)
	return cards.length === 0 ? (
		<p className="text-xs text-muted-foreground">
			{t("resources.detail.sidebar.colEmpty")}
		</p>
	) : (
		<div
			className="-mx-2 flex flex-col"
			data-testid={`resource-detail-collection-${colId}`}
		>
			{cards.map((card) => (
				<ResourceRow key={card.id} resource={card} cacheKey={card.updatedAt} />
			))}
		</div>
	)
}

type ResRelatedByTagsSectionProps = {
	readonly resId: string
	readonly tagIds: readonly string[]
}

const RELATED_BY_TAGS_LIMIT = 5

/**
 * The top-N other resources ranked by tag-overlap count with the current
 * resource. Hidden when the resource has no tags (no overlap is
 * computable) or when no candidates exist.
 */
function ResRelatedByTagsSection(props: ResRelatedByTagsSectionProps) {
	const { resId, tagIds } = props
	const relatedQuery = useQuery({
		...relatedResourcesByTagsQueryOptions(resId, RELATED_BY_TAGS_LIMIT),
		enabled: tagIds.length > 0,
	})
	const cards = relatedQuery.data ?? []
	if (tagIds.length === 0 || cards.length === 0) return null
	return (
		<div className="flex flex-col gap-3">
			{cards.map((card) => (
				<ResCard
					key={card.id}
					resource={card}
					thumbFitWidth={PANEL_CONTENT_WIDTH_PX}
				/>
			))}
		</div>
	)
}

/**
 * Hash-based image relations: exact duplicates (byte-identical files),
 * perceptual similar images, and within-resource similarity groups.
 * Hidden entirely until the owning plugin's hash rebuild has produced
 * results — the server computes hashes asynchronously after upload, so
 * these sections pop in via the `imageHashes` SSE event.
 */
function ResImageSimilaritySection(props: { readonly resId: string }) {
	const { resId } = props
	const { t } = useTranslation()
	const similarQuery = useQuery(similarImagesQueryOptions(resId))
	const withinQuery = useQuery(similarWithinQueryOptions(resId))
	const duplicateQuery = useQuery(duplicateImagesQueryOptions(resId))
	const similar = similarQuery.data ?? []
	const within = withinQuery.data ?? []
	const duplicates = duplicateQuery.data ?? []
	if (duplicates.length === 0 && similar.length === 0 && within.length === 0)
		return null
	return (
		<div className="flex flex-col gap-8">
			{duplicates.length > 0 ? (
				<section
					className="flex flex-col gap-3"
					data-testid="resource-detail-duplicate-images"
				>
					<SectionLabel>
						{t("resources.detail.sidebar.duplicateImagesHeading")}
					</SectionLabel>
					<div className="flex flex-col gap-3">
						{duplicates.map((entry) => (
							<SimilarityEntry
								key={entry.resource.id}
								resourceId={entry.resource.id}
								count={entry.files.length}
								labelKey="resources.detail.sidebar.duplicateCount"
								thumbResId={resId}
								files={entry.files.map((file) => ({ scope: file.scope }))}
							/>
						))}
					</div>
				</section>
			) : null}
			{similar.length > 0 ? (
				<section
					className="flex flex-col gap-3"
					data-testid="resource-detail-similar-images"
				>
					<SectionLabel>
						{t("resources.detail.sidebar.similarImagesHeading")}
					</SectionLabel>
					<div className="flex flex-col gap-3">
						{similar.map((entry) => (
							<SimilarityEntry
								key={entry.resource.id}
								resourceId={entry.resource.id}
								count={entry.files.length}
								labelKey="resources.detail.sidebar.imageMatchCount"
								thumbResId={entry.resource.id}
								files={entry.files}
							/>
						))}
					</div>
				</section>
			) : null}
			{within.length > 0 ? (
				<section
					className="flex flex-col gap-3"
					data-testid="resource-detail-similar-within"
				>
					<SectionLabel>
						{t("resources.detail.sidebar.similarWithinHeading")}
					</SectionLabel>
					<div className="flex flex-col gap-3">
						{within.map((group) => (
							<div
								key={group.files.map((file) => file.scope).join("|")}
								className="flex flex-col gap-1"
							>
								<MatchThumbStrip resId={resId} files={group.files} />
								<p className="text-xs text-muted-foreground">
									{t("resources.detail.sidebar.intraSimilarCount", {
										count: group.files.length,
									})}
								</p>
							</div>
						))}
					</div>
				</section>
			) : null}
		</div>
	)
}

/**
 * One matched resource in the similarity rail: the resource card
 * (fetched via the shared card query so covers/tags render) plus a
 * match-count line and a strip of matched-file previews. `thumbResId`
 * names the resource whose files are previewed — the matched resource
 * for similar images, the query resource for duplicates.
 */
function SimilarityEntry(props: {
	readonly resourceId: string
	readonly count: number
	readonly labelKey: string
	readonly thumbResId: string
	readonly files: readonly MatchFile[]
}) {
	const { resourceId, count, labelKey, thumbResId, files } = props
	const { t } = useTranslation()
	const cardQuery = useQuery(resDetailCardQueryOptions(resourceId))
	const card = cardQuery.data
	if (card === undefined) return null
	const percent = bestMatchSimilarity(files)
	return (
		<div className="flex flex-col gap-1">
			<ResCard
				resource={card}
				thumbFitWidth={PANEL_CONTENT_WIDTH_PX}
				metaLeft={
					percent !== undefined ? (
						<span data-testid="similar-entry-similarity">
							{t("resources.detail.sidebar.similarity", { percent })}
						</span>
					) : undefined
				}
			/>
			<p className="text-xs text-muted-foreground">{t(labelKey, { count })}</p>
			<MatchThumbStrip resId={thumbResId} files={files} />
		</div>
	)
}
