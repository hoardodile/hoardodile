import { TagChip } from "@hoardodile/ui/components/tag-chip"
import { More } from "@hoardodile/ui/icons/actions"
import {
	Download,
	Eye,
	FileText,
	Filter,
	Folder,
	Gallery,
	Heart,
	InfoCircle,
	Magnifier,
	MagnifierZoomIn,
	MusicNotes,
	Pause,
	Play,
	Repeat,
	Star,
	Tag,
	VideoFrame,
	VideoFramePlayHorizontal,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import {
	formatBytes,
	type IconRef,
	normalizeSolarGlyphName,
	renderSlotBadges,
	type TemplateContext,
} from "@hoardodile/ui/res-card-template"
import type { ComponentType, ReactNode } from "react"
import { useState } from "react"
import type {
	HookSnapshot,
	WorkbenchManifest,
	WorkbenchResource,
} from "../context.ts"
import { resolveSolarIconComponent } from "../icons/solar-icon"
import {
	buildMockCardMeta,
	buildResCardAssetUrl,
	formatMockDate,
	pickCardSlotUi,
	readSourceMetaDims,
	resolveCoverKind,
} from "../res-card-preview.ts"

// The workbench's res-card badge renderer. Solar glyph names resolve
// through a small synchronously-imported registry set first (the same one
// the app's card uses for the common glyphs — no async hop, no flash on
// first paint); anything else resolves through the lazy full-set index, so
// any installed Solar glyph renders with the same three-weight/`mode`/
// icon-style semantics. Unknown glyphs draw nothing.
// Manifest-relative `asset('path')` references resolve to the `/data`
// mount for the selected resource.
const SYNC_ICONS: Readonly<
	Record<string, ComponentType<{ className?: string }>>
> = {
	download: Download,
	eye: Eye,
	file: FileText,
	"file-text": FileText,
	"video-frame": VideoFrame,
	"video-frame-play-horizontal": VideoFramePlayHorizontal,
	filter: Filter,
	folder: Folder,
	gallery: Gallery,
	heart: Heart,
	"info-circle": InfoCircle,
	"music-notes": MusicNotes,
	magnifier: Magnifier,
	pause: Pause,
	play: Play,
	repeat: Repeat,
	star: Star,
	tag: Tag,
}

/**
 * A faithful, non-interactive replica of the app's resource card: the real
 * cover + the plugin's `manifest.ui.card` corner badges, plus fabricated
 * app-level metadata (tags, collections, source, size, date)
 * so the preview reads like a real in-app resource. Hover shows the
 * cover wash + magnifier affordance and the name underline, but nothing
 * is clickable — it is a visual preview.
 */
export function ResCardPreview(props: {
	readonly manifest: WorkbenchManifest
	readonly resource: WorkbenchResource
	readonly snapshot: HookSnapshot | null
	readonly locale: string
}) {
	const { manifest, resource, snapshot, locale } = props
	const [coverFailed, setCoverFailed] = useState(false)
	const mock = buildMockCardMeta()

	const coverKind = resolveCoverKind(snapshot)
	const slotUi = pickCardSlotUi(manifest, coverKind)
	const coverDims = readSourceMetaDims(snapshot)

	const scope = {
		file: snapshot?.fileStats,
		source: snapshot?.sourceMeta,
		searchMeta: snapshot?.searchMeta,
	}
	const ctx: TemplateContext = {
		locale,
		pluginId: manifest.id,
		manifest,
		iconClassName: "size-3.5",
		renderIcon,
		buildAssetUrl: (_pluginId, path) => buildResCardAssetUrl(resource.id, path),
	}
	const tl = slotUi?.tl ? renderSlotBadges(slotUi.tl, scope, ctx) : []
	const bl = slotUi?.bl ? renderSlotBadges(slotUi.bl, scope, ctx) : []
	const br = slotUi?.br ? renderSlotBadges(slotUi.br, scope, ctx) : []

	const coverSrc = `/api/resources/${encodeURIComponent(resource.id)}/cover`

	return (
		<div className="flex flex-col gap-1">
			{/* ── Thumbnail: cover + badges + hover (fake, no click) ── */}
			<div
				className={cn(
					"group relative m-auto w-full max-w-sm overflow-hidden rounded-xl bg-muted",
					coverDims === undefined && "aspect-square",
				)}
				style={
					coverDims
						? { aspectRatio: `${coverDims.width} / ${coverDims.height}` }
						: undefined
				}
			>
				{!coverFailed ? (
					<img
						key={coverSrc}
						src={coverSrc}
						alt=""
						referrerPolicy="no-referrer"
						className="absolute inset-0 h-full w-full object-cover"
						onError={() => setCoverFailed(true)}
					/>
				) : null}
				{/* Hover wash + magnifier: purely decorative (no click). */}
				<div className="pointer-events-none absolute inset-0 rounded-xl bg-white opacity-0 transition-opacity duration-300 group-hover:opacity-20" />
				<span className="pointer-events-none absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-foreground/90 text-background opacity-0 shadow-card transition-opacity duration-200 group-hover:opacity-100">
					<MagnifierZoomIn className="size-4" />
				</span>
				<span className="pointer-events-none absolute top-11 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-foreground/90 text-background opacity-0 shadow-card transition-opacity duration-200 group-hover:opacity-100">
					<More className="h-4 w-4" />
				</span>
				{tl.length > 0 ? (
					<div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1">
						{tl.map((badge, i) => (
							<SlotBadge key={i}>{badge}</SlotBadge>
						))}
					</div>
				) : null}
				{bl.length > 0 ? (
					<div className="absolute bottom-2 left-2 z-10 flex flex-col items-start gap-1">
						{bl.map((badge, i) => (
							<SlotBadge key={i}>{badge}</SlotBadge>
						))}
					</div>
				) : null}
				{br.length > 0 ? (
					<div className="absolute right-2 bottom-2 z-10 flex flex-col items-end gap-1">
						{br.map((badge, i) => (
							<SlotBadge key={i}>{badge}</SlotBadge>
						))}
					</div>
				) : null}
			</div>

			{/* ── Name (hover underline, no navigation) ── */}
			<div className="min-w-0 overflow-hidden">
				<span className="block w-full truncate text-base font-medium hover:underline">
					{resource.name}
				</span>
			</div>

			{/* ── Pinned tags row (source + tags) ── */}
			<div className="flex flex-wrap gap-1.5">
				<TagChip color="" className="max-w-25">
					{mock.sourceName}
				</TagChip>
				{mock.tags.map((tag) => (
					<TagChip key={tag.name} color={tag.color} className="max-w-25">
						{tag.name}
					</TagChip>
				))}
			</div>

			{/* ── Collection chips ── */}
			{mock.collections.length > 0 ? (
				<div className="mt-0.5 flex flex-wrap gap-1.5">
					{mock.collections.map((col) => (
						<TagChip key={col.name} color={col.color}>
							{col.name}
						</TagChip>
					))}
				</div>
			) : null}

			{/* ── File size & date ── */}
			<div className="flex justify-between text-tiny text-muted-foreground">
				<span className="truncate">{formatBytes(mock.sizeBytes)}</span>
				<span className="shrink-0">
					{formatMockDate(mock.createdAt, locale)}
				</span>
			</div>
		</div>
	)
}

function SlotBadge({ children }: { readonly children: ReactNode }) {
	return (
		<span className="inline-flex h-5 items-center gap-1 rounded-md bg-foreground/90 px-1.5 text-tiny leading-none text-background shadow-card">
			{children}
		</span>
	)
}

function renderIcon(ref: IconRef, className?: string): ReactNode {
	if (ref.kind === "asset") {
		return (
			<img
				src={ref.url}
				alt=""
				className={`${className ?? ""} object-contain`}
				draggable={false}
			/>
		)
	}
	const name = normalizeSolarGlyphName(ref.name)
	if (name === undefined) return null
	const Sync = SYNC_ICONS[name]
	if (Sync !== undefined) return <Sync className={className} />
	const Lazy = resolveSolarIconComponent(name)
	if (Lazy === undefined) return null
	return <Lazy className={className} />
}
