import { pickCoverKind, populatedCover } from "@hoardodile/schemas"
import type { CoverKindUi, PluginManifest } from "@hoardodile/sdk-types"
import { buildResThumbCacheKey } from "@hoardodile/shared"
import { MagnifierZoomIn as MagniferZoomIn } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import {
	Children,
	type CSSProperties,
	Fragment,
	type ReactNode,
	useMemo,
} from "react"
import { useTranslation } from "react-i18next"
import { pluginListAllQueryOptions } from "@/features/plugin"
import {
	type ResMediaThumbResource,
	useResDisplayResource,
} from "@/features/res/hooks/useResDisplayResource"
import {
	renderSlotBadges,
	type TemplateContext,
} from "@/features/res/template/render"
import {
	buildPluginAssetUrl,
	Icon,
} from "@/features/res/template/template-icons"
import { AUDIO_TILE_HEIGHT, ResAudioPlayer } from "./ResAudioPlayer"
import { ResThumb } from "./ResThumb"
import { ResVideoHover } from "./ResVideoHover"

export type { ResMediaThumbResource } from "@/features/res/hooks/useResDisplayResource"

export type ResMediaThumbProps = {
	readonly resource: ResMediaThumbResource
	readonly className?: string
	/**
	 * Sizing strategy:
	 *  - `"intrinsic"` (default): scale cover dimensions to fit within
	 *    `maxWidth`/`maxHeight`, mirroring the resources page card.
	 *  - `"fill"`: occupy the parent's box (caller controls width/height).
	 *  - `"fit-height"`: cap the height at `maxHeight` and derive the width
	 *    from the cover's aspect ratio (scale down only — a short cover
	 *    keeps its natural height; without cover metadata the tile falls
	 *    back to a square at `maxHeight`) — for uniform-ceiling rows such
	 *    as the overview pinned strip.
	 *  - `"fit-width"`: the mirror of fit-height — cap the width at
	 *    `maxWidth` and derive the height from the cover's aspect ratio
	 *    (scale down only — a narrow cover keeps its natural width;
	 *    without cover metadata the tile falls back to a square at
	 *    `maxWidth`) — for masonry columns.
	 */
	readonly sizing?: "intrinsic" | "fill" | "fit-height" | "fit-width"
	readonly maxWidth?: number
	readonly maxHeight?: number
	readonly minHeight?: number
	readonly minWidth?: number
	/**
	 * When provided and the resource is a video, enable the inline video
	 * preview-on-hover. Receives the user's intent to open a full preview
	 * dialog (clicking the centered play button while playing).
	 */
	readonly onVideoZoomRequest?: () => void
	/**
	 * When provided, renders a magnifying-glass button that calls this
	 * callback. Also shows a white hover overlay for non-video resources.
	 */
	readonly onPreviewRequest?: () => void
	/**
	 * Show the magnifying-glass preview button on touch screens (below
	 * `md`) without a hover, mirroring the card actions trigger. Defaults
	 * to false: the button stays hover-only, which inline BlockNote
	 * embeds rely on so ProseMirror mousedowns are never intercepted.
	 */
	readonly previewButtonTouchVisible?: boolean
	/**
	 * Optional badge rendered as the last (lowest) item of the bottom-left
	 * slot-badge stack, e.g. the plugin-type badge on cards. Plugin-configured
	 * `bl` badges always stack above it.
	 */
	readonly blTrailingBadge?: ReactNode
}

/**
 * Bare resource thumbnail tile: just the cover image plus the media-type
 * and file-count corner pills, with optional video-hover playback.
 *
 * Used as the visual core of {@link ResCard} on the resources page,
 * and standalone as an inline embed inside documents where the full card
 * (action menu, edit dialogs, preview button, etc.) would be visual noise.
 */
export function ResMediaThumb(props: ResMediaThumbProps) {
	const {
		resource: resourceProp,
		className,
		sizing = "intrinsic",
		maxWidth,
		maxHeight,
		minHeight,
		minWidth,
		onVideoZoomRequest,
		onPreviewRequest,
		previewButtonTouchVisible,
		blTrailingBadge,
	} = props
	const resource = useResDisplayResource(resourceProp)
	const {
		id,
		name,
		contentPluginId,
		coverMeta,
		updatedAt,
		sourceMeta,
		searchMeta,
		fileStats,
	} = resource
	const coverKind = pickCoverKind(coverMeta)
	const coverSize = populatedCover(coverMeta)
	const cacheKey = buildResThumbCacheKey({ updatedAt })
	const isVideo = coverKind === "video"
	// Audio only has artwork when the file embeds it (or the user pinned a
	// cover) — both paths land the artwork's dimensions in `coverMeta`.
	// Without them there is nothing to show, so the player takes the tile.
	const isAudio = coverKind === "audio"
	const hasAudioArtwork =
		isAudio && coverSize?.width !== undefined && coverSize.height !== undefined
	const audioTileOnly = isAudio && !hasAudioArtwork
	const style = audioTileOnly
		? buildAudioTileStyle(sizing, { maxWidth, maxHeight, minWidth })
		: sizing === "fill"
			? undefined
			: buildIntrinsicStyle(coverSize?.width, coverSize?.height, {
					maxWidth,
					maxHeight,
					minHeight,
					minWidth,
					fitHeight: sizing === "fit-height",
					fitWidth: sizing === "fit-width",
				})

	const cardUi = usePluginCardUi(contentPluginId, coverKind)
	const { i18n } = useTranslation()
	const locale = i18n.language

	const scope = useMemo(
		() => ({
			file: fileStats,
			source: sourceMeta,
			searchMeta,
			coverMeta,
		}),
		[fileStats, sourceMeta, searchMeta, coverMeta],
	)

	const ctx: TemplateContext = {
		locale,
		pluginId: contentPluginId ?? "",
		manifest: cardUi?.manifest ?? {},
		iconClassName: "size-3.5",
		renderIcon: (ref, className) => Icon({ icon: ref, className }),
		buildAssetUrl: buildPluginAssetUrl,
	}

	const tlBadges = cardUi?.slotUi?.tl
		? renderSlotBadges(cardUi.slotUi.tl, scope, ctx)
		: []
	const blBadges = cardUi?.slotUi?.bl
		? renderSlotBadges(cardUi.slotUi.bl, scope, ctx)
		: []
	const brBadges = cardUi?.slotUi?.br
		? renderSlotBadges(cardUi.slotUi.br, scope, ctx)
		: []

	return (
		<div
			className={`group relative overflow-hidden rounded-xl ${className ?? ""}`}
			style={style}
		>
			{audioTileOnly ? (
				<ResAudioPlayer resId={id} resName={name} variant="tile" />
			) : (
				<ResThumb
					resId={id}
					cacheKey={cacheKey}
					name={name}
					alt={name}
					maxWidth={maxWidth}
					maxHeight={maxHeight}
					fill={sizing === "fit-height"}
					className="absolute inset-0 h-full w-full rounded-xl"
				/>
			)}
			{isVideo && onVideoZoomRequest !== undefined ? (
				<ResVideoHover
					resId={id}
					resName={name}
					onZoomRequest={onVideoZoomRequest}
				/>
			) : null}
			{hasAudioArtwork ? (
				<ResAudioPlayer resId={id} resName={name} variant="overlay" />
			) : null}
			{/* ── Slot overlays ──────────────────────────────────────── */}
			{tlBadges.length > 0 ? (
				<div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1">
					{tlBadges.map((badge, i) => (
						<SlotBadge key={i}>
							{Array.isArray(badge)
								? Children.toArray(badge).map((node, j) => (
										<Fragment key={j}>{node}</Fragment>
									))
								: badge}
						</SlotBadge>
					))}
				</div>
			) : null}
			{blBadges.length > 0 || blTrailingBadge !== undefined ? (
				<div className="absolute bottom-2 left-2 z-10 flex flex-col items-start gap-1">
					{blBadges.map((badge, i) => (
						<SlotBadge key={i}>
							{Array.isArray(badge)
								? Children.toArray(badge).map((node, j) => (
										<Fragment key={j}>{node}</Fragment>
									))
								: badge}
						</SlotBadge>
					))}
					{blTrailingBadge}
				</div>
			) : null}
			{brBadges.length > 0 ? (
				<div className="absolute right-2 bottom-2 z-10 flex flex-col items-end gap-1">
					{brBadges.map((badge, i) => (
						<SlotBadge key={i}>
							{Array.isArray(badge)
								? Children.toArray(badge).map((node, j) => (
										<Fragment key={j}>{node}</Fragment>
									))
								: badge}
						</SlotBadge>
					))}
				</div>
			) : null}
			{/* Hover wash for still covers. Video and the audio tile carry
			    their own playback surfaces, so the wash would only muddy
			    their controls. */}
			{!isVideo && !audioTileOnly ? (
				<div className="pointer-events-none absolute inset-0 rounded-xl bg-white opacity-0 transition-opacity duration-300 group-hover:opacity-20" />
			) : null}
			{/* Magnifying-glass preview button at top-right. Revealed on
			    hover so it never occludes the underlying thumb area —
			    important when the thumb is an inline BlockNote node, where
			    a permanently-mounted button intercepts the mousedown that
			    ProseMirror needs to start a NodeSelection. While hidden it
			    ignores pointer events. Card grids opt into
			    `previewButtonTouchVisible` so touch screens (no hover)
			    see the button like the actions trigger. */}
			{onPreviewRequest !== undefined ? (
				<button
					type="button"
					aria-label={name}
					onClick={onPreviewRequest}
					className={
						previewButtonTouchVisible
							? "pointer-events-auto absolute right-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-foreground/90 text-background opacity-100 shadow-card transition-opacity duration-200 focus-visible:opacity-100 md:pointer-events-none md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:opacity-100 hover:bg-foreground hover:text-background"
							: "pointer-events-none absolute right-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-foreground/90 text-background opacity-0 shadow-card transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-foreground hover:text-background"
					}
				>
					<MagniferZoomIn className="size-4" />
				</button>
			) : null}
		</div>
	)
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function SlotBadge({ children }: { readonly children: React.ReactNode }) {
	return (
		<span className="inline-flex h-5 items-center gap-1 rounded-md bg-foreground/90 px-1.5 text-tiny leading-none text-background shadow-card">
			{children}
		</span>
	)
}

type IntrinsicBounds = {
	readonly maxWidth?: number
	readonly maxHeight?: number
	readonly minHeight?: number
	readonly minWidth?: number
	/** Cap the height at `maxHeight`, never a target — scale down only. */
	readonly fitHeight?: boolean
	/** Cap the width at `maxWidth`, never a target — scale down only. */
	readonly fitWidth?: boolean
}

/**
 * Geometry for the artwork-less audio tile: a fixed-height rectangle
 * whose width follows the caller's sizing mode. Audio has no intrinsic
 * dimensions to scale, so the height is a constant rather than something
 * derived — the tile is a player, not a cover.
 */
function buildAudioTileStyle(
	sizing: NonNullable<ResMediaThumbProps["sizing"]>,
	bounds: IntrinsicBounds,
): CSSProperties | undefined {
	// `fill` hands the box to the caller; the player stretches into it.
	if (sizing === "fill") return undefined
	const height =
		bounds.maxHeight === undefined
			? AUDIO_TILE_HEIGHT
			: Math.min(AUDIO_TILE_HEIGHT, bounds.maxHeight)
	if (sizing === "fit-height") {
		// Uniform-ceiling strips size every tile off `maxHeight`; the audio
		// tile keeps that as its width so the row's rhythm survives.
		return { width: bounds.maxHeight, height }
	}
	// Masonry columns and the default grid both let the card decide the
	// width; the tile fills it inside the card's own min/max bounds.
	return {
		width: "100%",
		minWidth: bounds.minWidth,
		maxWidth: bounds.maxWidth,
		height,
	}
}

/**
 * Computes explicit pixel dimensions so the browser reserves the exact
 * fitted box before the cover loads. See {@link ResCard} for the
 * background on why CSS aspect-ratio + max-* alone is insufficient.
 */
function buildIntrinsicStyle(
	width: number | undefined,
	height: number | undefined,
	bounds: IntrinsicBounds,
): CSSProperties {
	const maxW = bounds.maxWidth ?? Number.POSITIVE_INFINITY
	const maxH = bounds.maxHeight ?? Number.POSITIVE_INFINITY
	if (bounds.fitHeight === true) {
		if (Number.isFinite(maxH)) {
			if (width !== undefined && height !== undefined && height > 0) {
				// The cap is a ceiling, never a target — only taller covers
				// scale down, shorter ones keep their natural height. Past
				// `maxWidth` the width clamp wins and the height rescales
				// proportionally, so ultra-wide covers stay bounded.
				const scale = Math.min(1, maxH / height)
				let fittedWidth = Math.round(width * scale)
				let fittedHeight = Math.round(height * scale)
				if (fittedWidth > maxW) {
					fittedWidth = maxW
					fittedHeight = Math.round((height / width) * maxW)
				}
				return { width: fittedWidth, height: fittedHeight }
			}
			// No cover metadata: fall back to the configured height so the
			// tile keeps the strip's rhythm instead of collapsing.
			return { width: maxH, height: maxH }
		}
	} else if (bounds.fitWidth === true) {
		if (Number.isFinite(maxW)) {
			if (width !== undefined && height !== undefined && height > 0) {
				// The mirror of fit-height: only wider covers scale down,
				// narrower ones keep their natural width. Past `maxHeight`
				// the height clamp wins and the width rescales, so
				// ultra-tall covers stay bounded.
				const scale = Math.min(1, maxW / width)
				let fittedWidth = Math.round(width * scale)
				let fittedHeight = Math.round(height * scale)
				if (fittedHeight > maxH) {
					fittedHeight = maxH
					fittedWidth = Math.round((width / height) * maxH)
				}
				return { width: fittedWidth, height: fittedHeight }
			}
			// No cover metadata: fall back to the configured width so the
			// tile keeps the column's rhythm instead of collapsing.
			return { width: maxW, height: maxW }
		}
	} else if (width !== undefined && height !== undefined && height > 0) {
		if (Number.isFinite(maxW) && Number.isFinite(maxH)) {
			const scale = Math.min(maxW / width, maxH / height, 1)
			return { width: width * scale, height: height * scale }
		}
	}
	return {
		minHeight: bounds.minHeight,
		minWidth: bounds.minWidth,
		maxHeight: Number.isFinite(maxH) ? maxH : undefined,
	}
}

/**
 * Look up the plugin manifest for a resource and return the
 * {@link CoverKindUi} entry that matches the resource's `coverKind`,
 * together with the manifest itself (used for badge templates). Returns
 * `undefined` when the resource has no content plugin; the manifest stays
 * `undefined` until the plugin list settles or when the plugin is unknown.
 */
function usePluginCardUi(
	pluginId: string | null,
	coverKind: "image" | "video" | "audio" | undefined,
):
	| {
			readonly slotUi: CoverKindUi | undefined
			readonly manifest: PluginManifest | undefined
	  }
	| undefined {
	const pluginQuery = useQuery(pluginListAllQueryOptions())
	return useMemo(() => {
		if (pluginId === null) return undefined
		const plugins = pluginQuery.data ?? []
		const entry = plugins.find((p) => p.id === pluginId)
		if (entry === undefined) {
			return { slotUi: undefined, manifest: undefined }
		}
		// Kind-specific block wins when the plugin declares it; a resource
		// whose cover kind has no block (e.g. a user-pinned image cover on
		// a plugin that configures only `default`) falls back to `default`
		// so configured corner badges never vanish on cover set/clear.
		const card = entry.manifest.ui?.card
		const slotUi = card?.[coverKind ?? "default"] ?? card?.default
		return {
			slotUi,
			manifest: entry.manifest,
		}
	}, [pluginId, coverKind, pluginQuery.data])
}
