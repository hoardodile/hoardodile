import type { IconType } from "@hoardodile/ui/components/icon"
import { IconTile } from "@hoardodile/ui/components/icon-tile"
import { parseIconRef } from "@/features/res/template/template-icons"
import { resolveSolarIconComponent } from "./solar-icon"

/**
 * The plugin card/row tile: renders the manifest-declared `icon` — a
 * Solar glyph name (lazy three-weight glyph, same preference semantics as
 * every registry icon) or a zip asset path (`assets/icon.svg`, served
 * from the plugin's own directory) — falling back to the caller's icon
 * when the manifest declares none or the reference is unusable.
 * Icon resolution never throws: unknown names and unreachable assets
 * degrade to the fallback or an empty image, never an error.
 */
export function PluginTileIcon(props: {
	readonly iconRef?: string
	readonly pluginId: string
	readonly fallback: IconType
}) {
	const ref =
		props.iconRef === undefined
			? undefined
			: parseIconRef(props.iconRef, props.pluginId)
	if (ref === undefined) return <IconTile icon={props.fallback} />
	if (ref.kind === "asset") {
		return (
			<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-secondary-foreground">
				<img
					src={ref.url}
					alt=""
					className="size-4 object-contain"
					draggable={false}
				/>
			</span>
		)
	}
	return (
		<IconTile icon={resolveSolarIconComponent(ref.name) ?? props.fallback} />
	)
}
