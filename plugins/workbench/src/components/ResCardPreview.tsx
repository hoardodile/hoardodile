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
	MusicNotes,
	Pause,
	Play,
	Star,
	Tag,
	VideoFrame,
	VideoFramePlayHorizontal,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import {
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
import {
	buildResCardAssetUrl,
	pickCardSlotUi,
	readSourceMetaDims,
	resolveCoverKind,
} from "../res-card-preview.ts"

// The workbench's res-card badge renderer. Solar glyph names resolve
// through a small synchronously-imported registry set (the same one the
// app's card uses for the common glyphs); unknown glyphs draw nothing.
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
	star: Star,
	tag: Tag,
}

export function ResCardPreview(props: {
	readonly manifest: WorkbenchManifest
	readonly resource: WorkbenchResource
	readonly snapshot: HookSnapshot | null
	readonly locale: string
}) {
	const { manifest, resource, snapshot, locale } = props
	const [coverFailed, setCoverFailed] = useState(false)

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
			<div className="min-w-0">
				<span className="block w-full truncate text-base font-medium">
					{resource.name}
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
	if (Sync === undefined) return null
	return <Sync className={className} />
}
