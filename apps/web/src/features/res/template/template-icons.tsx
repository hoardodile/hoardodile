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
import { apiPaths } from "@/lib/paths"

/**
 * Curated whitelist mapping an icon-ref name to its registry icon (the
 * dual-tone default; swaps to linear in the `linear` icon style). Plugins
 * can only use names listed here; unknown names render to nothing. Expand
 * this list when concrete plugin authors need more.
 */
export const ICON_REGISTRY: Record<
	string,
	ComponentType<{ className?: string }>
> = {
	Download: Download,
	Eye: Eye,
	Files: FileText,
	FileText: FileText,
	Film: VideoFrame,
	Filter: Filter,
	Folder: Folder,
	Gallery: Gallery,
	Heart: Heart,
	Image: Gallery,
	Info: InfoCircle,
	Music: MusicNotes,
	Pause: Pause,
	Play: Play,
	Search: Magnifier,
	Sparkle: Star,
	Star: Star,
	Tag: Tag,
	Video: VideoFrame,
}

export type IconRef =
	| { readonly kind: "icon"; readonly name: string }
	| { readonly kind: "asset"; readonly url: string }

/**
 * Parse a manifest-level icon string into a render-ready ref.
 *
 *   `<name>`            — whitelist lookup (no dots or path separators)
 *   `<relative/path>`   — `/api/plugins/<pluginId>/<path>` (leading `./` stripped)
 *
 * Empty inputs return `undefined`. The renderer treats that as "nothing".
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
		if (rel.length === 0) return undefined
		return { kind: "asset", url: apiPaths.plugins.asset(pluginId, rel) }
	}
	return { kind: "icon", name: trimmed }
}

export type IconProps = {
	readonly icon: IconRef
	readonly className?: string
}

/**
 * Render a parsed {@link IconRef}. `object-contain` clamps any asset image
 * (svg / png / **gif** / webp) into the box defined by `className`; the
 * source is never validated for type or dimensions. Icon refs whose name
 * is not in {@link ICON_REGISTRY} render nothing.
 */
export function Icon(props: IconProps) {
	// Opt out of React Compiler: render.ts calls this as a plain function
	// (outside a React render), where the compiler's memo cache has no
	// dispatcher and would throw.
	"use no memo"
	const { icon, className } = props
	if (icon.kind === "icon") {
		const Component = ICON_REGISTRY[icon.name]
		if (Component === undefined) return null
		return <Component className={className} />
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
