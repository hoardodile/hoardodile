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
} from "@hoardodile/ui/icons/registry"
import type { ComponentType } from "react"
import { createElement } from "react"
import { resolveSolarIconComponent } from "@/features/plugin/icons/solar-icon"
import { normalizeSolarGlyphName } from "@/features/plugin/icons/solar-name"
import { apiPaths } from "@/lib/paths"

/**
 * Curated synchronous whitelist — the legacy `icon('Name')` set, resolved
 * instantly from the already-bundled registry (no async hop, no flash on
 * the first paint of a cover grid). Everything else renders through the
 * lazy Solar index, which covers the full glyph set with the same
 * three-weight/`mode`/preference semantics.
 */
const SYNC_ICONS: Readonly<
	Record<string, ComponentType<{ className?: string }>>
> = {
	download: Download,
	eye: Eye,
	file: FileText,
	"file-text": FileText,
	"video-frame": VideoFrame,
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

export type IconRef =
	| { readonly kind: "icon"; readonly name: string }
	| { readonly kind: "asset"; readonly url: string }

/**
 * Parse a manifest-level icon string into a render-ready ref.
 *
 *   `<SolarGlyph>`       — Solar glyph name (manifest/template icons are
 *                          Solar-only; PascalCase and the legacy whitelist
 *                          names normalize to the kebab glyph)
 *   `<relative/path>`    — `/api/plugins/<pluginId>/<path>` (leading `./` stripped)
 *
 * Empty inputs, schemes (`http(s)`, `data:`), `..`-shaped paths and any
 * string that cannot name a glyph return `undefined`. The renderer treats
 * that as "nothing" — icon resolution never throws.
 */
export function parseIconRef(
	raw: string,
	pluginId: string,
): IconRef | undefined {
	const trimmed = raw.trim()
	if (trimmed.length === 0) return undefined
	if (
		trimmed.startsWith("http://") ||
		trimmed.startsWith("https://") ||
		trimmed.startsWith("data:")
	) {
		return undefined
	}
	if (
		trimmed.includes(".") ||
		trimmed.includes("/") ||
		trimmed.includes("\\")
	) {
		const rel = trimmed.replace(/^\.[\\/]/, "")
		if (rel.length === 0 || rel.split("/").includes("..")) return undefined
		return { kind: "asset", url: apiPaths.plugins.asset(pluginId, rel) }
	}
	const name = normalizeSolarGlyphName(trimmed)
	if (name === undefined) return undefined
	return { kind: "icon", name }
}

export type IconProps = {
	readonly icon: IconRef
	readonly className?: string
}

/**
 * Render a parsed {@link IconRef}: Solar glyph names resolve through the
 * sync whitelist first (legacy names, instant) and the lazy full-set index
 * otherwise — both render the same three-weight wrapped components, so
 * the icon style preference and `mode` apply. `object-contain` clamps any
 * asset image (svg / png / **gif** / webp) into the box defined by
 * `className`; the source is never validated for type or dimensions.
 * Unknown names render nothing.
 */
export function Icon(props: IconProps) {
	// Opt out of React Compiler: render.ts calls this as a plain function
	// (outside a React render), where the compiler's memo cache has no
	// dispatcher and would throw.
	"use no memo"
	const { icon, className } = props
	if (icon.kind === "icon") {
		const name = normalizeSolarGlyphName(icon.name)
		if (name === undefined) return null
		const SyncComponent = SYNC_ICONS[name]
		if (SyncComponent !== undefined) {
			return createElement(SyncComponent, { className })
		}
		const LazyComponent = resolveSolarIconComponent(name)
		if (LazyComponent === undefined) return null
		return createElement(LazyComponent, { className })
	}
	return (
		<img
			src={icon.url}
			alt=""
			className={`${className ?? ""} object-contain`}
			draggable={false}
		/>
	)
}
