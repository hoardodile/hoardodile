import {
	populatedCover,
	type ResCard as ResCardData,
} from "@hoardodile/schemas"
import { Checkbox } from "@hoardodile/ui/components/checkbox"
import { Link } from "@tanstack/react-router"
import { memo, type ReactNode, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { CharChip } from "@/features/char/components/CharChip"
import { ResCollectionChips } from "@/features/col/ResColChips"
import { resolveManifestName, usePluginList } from "@/features/plugin"
import { useResDisplayResource } from "@/features/res/hooks/useResDisplayResource"
import { useDateFormatter } from "@/features/settings/datePrefs"
import { TagChipHover } from "@/features/tags/TagChipHover"
import { TagChipLink } from "@/features/tags/TagChipLink"
import { formatBytes } from "@/lib/formatBytes"
import { stopActiveMediaPreview } from "./mediaPlayback"
import { ResCardActions } from "./ResCardActions"
import { ResMediaThumb } from "./ResMediaThumb"
import { ResPreviewDialog } from "./ResPreviewDialog"
import { SourceChip } from "./SourceChip"

function PluginCornerBadge({ pluginId }: { readonly pluginId: string }) {
	const { i18n } = useTranslation()
	const { plugins } = usePluginList()
	const plugin = plugins.find((p) => p.id === pluginId)
	if (plugin?.pinned !== true) return null
	return (
		<span
			className="inline-flex h-5 items-center gap-1 rounded-md bg-foreground/90 px-1.5 text-tiny leading-none text-background shadow-card"
			style={plugin.color !== "" ? { color: plugin.color } : undefined}
		>
			{resolveManifestName(plugin.manifest, i18n.language)}
		</span>
	)
}

// ── Selection ────────────────────────────────────────────────────────────────

export type ResCardSelection = {
	readonly selected: boolean
	readonly onToggle: () => void
}

const MIN_HEIGHT_PX = 200
const MAX_HEIGHT_PX = 600
const MIN_WIDTH_PX = 200
const MAX_WIDTH_PX = 400

// ── Props ────────────────────────────────────────────────────────────────────

export type ResCardProps = {
	/**
	 * Resource data as returned by `resource.listCards`.
	 * Includes pre-resolved `pinnedTags` and `characters`.
	 */
	readonly resource: ResCardData
	readonly className?: string
	/**
	 * When provided the card switches to selection mode: the actions menu is
	 * hidden, the preview / video hover is suppressed, and a checkbox in the
	 * top-right corner reflects / toggles `selected`.
	 */
	readonly selection?: ResCardSelection
	/**
	 * Optional preview handler. When provided, the card will delegate preview
	 * opening to the parent (e.g. URL-backed preview in `<ResSearch>`) instead
	 * of owning a local `<ResPreviewDialog>` instance.
	 */
	readonly onPreviewRequest?: (resource: ResCardData) => void
	/**
	 * Browse-mode open handler: when provided, the thumbnail overlay and the
	 * name become buttons that call it with the card's root element instead
	 * of linking — the grid wires it to the shared-element card transition
	 * (DESIGN.md — the cover travel).
	 */
	readonly onOpenCard?: (card: HTMLElement) => void
	/**
	 * Uniform-ceiling mode for horizontal strips (overview pinned row): the
	 * thumbnail height is capped at this value — scale down only, a short
	 * cover keeps its natural height; without cover metadata the tile falls
	 * back to a square at this height — and the card drops the default
	 * min/max width bounds so narrow covers stay narrow instead of leaving
	 * blank space.
	 */
	readonly thumbFitHeight?: number
	/**
	 * Uniform-floor mode for masonry columns: the thumbnail width is capped
	 * at this value — scale down only, a narrow cover keeps its natural
	 * width; without cover metadata the tile falls back to a square at this
	 * width — the mirror of {@link thumbFitHeight}, just the other axis.
	 */
	readonly thumbFitWidth?: number
	/**
	 * Extra content for the trailing (bottom-left) spot of the card's meta
	 * row, rendered before the file size — e.g. a similarity percentage on
	 * image-search result cards.
	 */
	readonly metaLeft?: ReactNode
}

/**
 * Self-contained display card for a resource in grid views.
 *
 * Thumbnail with overlay, media-type corner pill, name, pinned tag chips,
 * character avatars, and a relative timestamp. Action menu and video playback
 * are owned by sibling components ({@link ResCardActions},
 * {@link ResVideoHover}) so this file stays focused on layout.
 */
export const ResCard = memo(function ResCard(props: ResCardProps) {
	const {
		resource: resourceProp,
		className,
		selection,
		onPreviewRequest,
		thumbFitHeight,
		thumbFitWidth,
		metaLeft,
		onOpenCard,
	} = props
	// Same merge as the thumb: list cards omit derived meta until the
	// backend backfill lands, and the compact 200px floor must yield to
	// cover width/height from that data — not stay locked on the list prop.
	const resource = useResDisplayResource(resourceProp)
	const {
		id,
		name,
		contentPluginId,
		previewPluginId,
		pinnedTags,
		characters,
		collections,
		fileStats,
		sourceMeta,
		searchMeta,
		createdAt,
		sourceName,
		sourceUrl,
	} = resource
	const formatter = useDateFormatter()

	const isSelectMode = selection !== undefined
	const fitWidthMode = thumbFitWidth !== undefined
	const fitHeightMode = !fitWidthMode && thumbFitHeight !== undefined
	// All content types are previewable via plugin render modules
	const isPreviewable = true
	// Without cover dimensions the tile renders its empty state; the card
	// itself then stays at the compact floor so the imageless placeholder
	// does not stretch across the whole grid cell.
	const coverSize = populatedCover(resource.coverMeta)
	const hasCoverDimensions =
		coverSize?.width !== undefined && coverSize.height !== undefined

	const [previewOpen, setPreviewOpen] = useState(false)
	const usesExternalPreview = onPreviewRequest !== undefined
	const rootRef = useRef<HTMLDivElement | null>(null)

	const { t } = useTranslation()

	// Stop any inline hover media still decoding behind the card before the
	// lightbox takes over the viewport.
	function openPreview() {
		stopActiveMediaPreview()
		if (usesExternalPreview) onPreviewRequest(resource)
		else setPreviewOpen(true)
	}

	function handleOpenCard() {
		if (onOpenCard === undefined) return
		const root = rootRef.current
		if (root !== null) onOpenCard(root)
	}

	return (
		<div
			ref={rootRef}
			className={`relative flex flex-col gap-1 ${className ?? ""}`}
			style={
				fitWidthMode
					? { minWidth: MIN_WIDTH_PX, maxWidth: thumbFitWidth }
					: fitHeightMode
						? // Fit-height mode: the thumbnail sets the width, but the card
							// keeps the usual floor so the name has room to read.
							{ minWidth: MIN_WIDTH_PX }
						: hasCoverDimensions
							? { minWidth: MIN_WIDTH_PX, maxWidth: MAX_WIDTH_PX }
							: // No cover: the card itself stays at the compact floor
								// (the empty tile already falls back to a square box there).
								{ minWidth: MIN_WIDTH_PX, maxWidth: MIN_WIDTH_PX }
			}
			data-resource-card-id={id}
		>
			{/* The selection ring hugs the thumb only. */}
			<div
				className={`group relative m-auto rounded-xl ${selection?.selected ? "ring-2 ring-primary" : ""}`}
			>
				<ResMediaThumb
					resource={resource}
					sizing={
						fitWidthMode
							? "fit-width"
							: fitHeightMode
								? "fit-height"
								: "intrinsic"
					}
					maxWidth={thumbFitWidth ?? MAX_WIDTH_PX}
					maxHeight={thumbFitHeight ?? MAX_HEIGHT_PX}
					minHeight={
						!fitWidthMode && !fitHeightMode ? MIN_HEIGHT_PX : undefined
					}
					minWidth={!fitWidthMode && !fitHeightMode ? MIN_WIDTH_PX : undefined}
					onVideoZoomRequest={isSelectMode ? undefined : openPreview}
					onPreviewRequest={
						isPreviewable && !isSelectMode ? openPreview : undefined
					}
					// Touch screens have no hover: keep the preview button
					// always visible below `md`, like the actions trigger.
					previewButtonTouchVisible
					blTrailingBadge={
						contentPluginId != null ? (
							<PluginCornerBadge pluginId={contentPluginId} />
						) : undefined
					}
					className="m-auto"
				/>

				{!isSelectMode ? (
					onOpenCard !== undefined ? (
						<button
							type="button"
							onClick={handleOpenCard}
							aria-label={name}
							// Sits above the cover image so clicks on the empty
							// thumbnail area navigate to the detail page.
							// Z-index stays below the action menu (z-10), the zoom
							// button (z-10) and the inline video play overlay
							// (z-20) so those still receive their own clicks.
							className="absolute inset-0 z-1 cursor-pointer rounded-xl"
							data-testid={`resource-open-${id}`}
						/>
					) : (
						<Link
							to="/resources/$id"
							params={{ id }}
							aria-label={name}
							tabIndex={-1}
							// Sits above the cover image so clicks on the empty
							// thumbnail area navigate to the detail page.
							// Z-index stays below the action menu (z-10), the zoom
							// button (z-10) and the inline video play overlay
							// (z-20) so those still receive their own clicks.
							className="absolute inset-0 z-1 rounded-xl"
							data-testid={`resource-card-link-${id}`}
						/>
					)
				) : null}

				{!isSelectMode ? (
					<ResCardActions
						resource={resource}
						topOffsetClass={isPreviewable ? "top-11" : "top-2"}
					/>
				) : null}

				{isSelectMode ? (
					<div className="absolute -top-2 -right-2 z-30">
						<Checkbox
							// The check sits more inset so the box reads as a
							// padded overlay, not a sticker crowding the cover.
							className="size-5 rounded-full border-2 border-border-strong bg-card [&>svg]:size-2.5"
							checked={selection.selected}
							onCheckedChange={() => selection.onToggle()}
							aria-label={t("resources.selectAria", { name })}
							data-testid={`resource-select-checkbox-${id}`}
						/>
					</div>
				) : null}
			</div>

			{/* ── Name ───────────────────────────────────────────────────── */}
			{/* In fit-height mode the card width comes from the thumbnail, so
			    the name must not contribute its own intrinsic width —
			    `w-0 min-w-full` zeroes that contribution while still filling
			    the card, letting truncate kick in at the card's width. */}
			<div
				className={`min-w-0 overflow-hidden ${thumbFitHeight === undefined ? "" : "w-0 min-w-full"}`}
			>
				{isSelectMode ? (
					<span
						className="block w-full truncate text-base font-medium"
						title={name}
						data-testid={`resource-item-${id}`}
					>
						{name}
					</span>
				) : onOpenCard !== undefined ? (
					<button
						type="button"
						onClick={handleOpenCard}
						className="block w-full truncate text-left text-base font-medium hover:underline"
						title={name}
						data-testid={`resource-open-name-${id}`}
					>
						{name}
					</button>
				) : (
					<Link
						to="/resources/$id"
						params={{ id }}
						className="block w-full truncate text-base font-medium hover:underline"
						title={name}
						data-testid={`resource-item-${id}`}
					>
						{name}
					</Link>
				)}
			</div>

			{/* ── Pinned tag chips (source first) ───────────────────────── */}
			{contentPluginId != null ||
			pinnedTags.length > 0 ||
			sourceName !== undefined ||
			sourceUrl !== undefined ? (
				<div className="flex flex-wrap gap-1.5">
					<SourceChip
						sourceName={sourceName}
						sourceUrl={sourceUrl}
						className="max-w-25"
					/>
					{pinnedTags.map((tag) => (
						<TagChipHover key={tag.id} tagId={tag.id}>
							<TagChipLink
								id={tag.id}
								type="resource"
								name={tag.name}
								color={tag.color}
								virtual={tag.virtual}
								className="max-w-25"
							/>
						</TagChipHover>
					))}
				</div>
			) : null}

			{/* ── Character avatars ───────────────────────────────────────── */}
			{characters.length > 0 ? (
				<div className="flex flex-wrap gap-1.5 mt-0.5">
					{characters.map((char) => (
						<CharChip
							key={char.id}
							charId={char.id}
							character={{
								name: char.name,
								updatedAt: char.updatedAt,
								imageMeta: char.imageMeta,
							}}
							disableLink={isSelectMode}
							showName
							className="max-w-30"
						/>
					))}
				</div>
			) : null}

			{/* ── Collection chips ───────────────────────────────────────── */}
			<ResCollectionChips collections={collections} />

			{/* ── File size & Date ───────────────────────────────────────── */}
			<div className="flex justify-between text-tiny text-muted-foreground">
				<span className="flex min-w-0 items-center gap-1.5">
					{metaLeft}
					{fileStats?.sizeBytes !== undefined ? (
						<span className="truncate">{formatBytes(fileStats.sizeBytes)}</span>
					) : null}
				</span>
				<span className="shrink-0">{formatter.formatDateTime(createdAt)}</span>
			</div>

			{/* ── Dialogs ────────────────────────────────────────────────── */}
			{isPreviewable && !isSelectMode && !usesExternalPreview ? (
				<ResPreviewDialog
					open={previewOpen}
					onOpenChange={setPreviewOpen}
					resId={id}
					resName={name}
					contentPluginId={contentPluginId ?? ""}
					previewPluginId={previewPluginId}
					sourceMeta={sourceMeta}
					searchMeta={searchMeta}
					fileStats={resource.fileStats}
				/>
			) : null}

			{/* ── Selection overlay covering the whole card ──────────────── */}
			{isSelectMode ? (
				<button
					type="button"
					onClick={() => selection.onToggle()}
					aria-label={t("resources.toggleSelectAria", { name })}
					aria-pressed={selection.selected}
					className="absolute inset-0 z-20 cursor-pointer rounded-xl"
					data-testid={`resource-select-${id}`}
				/>
			) : null}
		</div>
	)
})

// TagChipLink lives in `features/tags/TagChipLink` so the standalone resource
// detail page can render the same chip layout without depending on this
// file.
