import type { ResAnchor } from "@hoardodile/schemas"
import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Bookmark } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { pluginListAllQueryOptions } from "@/features/plugin"
import { resDetailCardQueryOptions } from "@/features/res"
import { renderCardTemplate } from "@/features/res/template/render"
import {
	buildPluginAssetUrl,
	Icon as RenderIcon,
} from "@/features/res/template/template-icons"
import { useAnchorJump } from "./useAnchorJump"

export type CommentAnchorChipProps = Readonly<{
	anchor: ResAnchor
	/**
	 * When true the resource name is omitted, leaving only the anchor
	 * label. Callers should set this when the chip is rendered on the
	 * resource's own detail page.
	 */
	hideResourceName?: boolean
}>

/**
 * Inline chip rendered next to a comment's body when it carries a
 * resource anchor. The label is rendered by the host's template engine
 * using the plugin's manifest-declared template; the host does not
 * hardcode any plugin-specific data shapes.
 */
export function CommentAnchorChip(props: CommentAnchorChipProps) {
	const { anchor, hideResourceName = false } = props
	const jump = useAnchorJump()
	const label = useAnchorLabel(anchor)
	const resourceName = useResourceName(anchor)
	const showName = !hideResourceName && resourceName.length > 0
	return (
		<Button
			type="button"
			variant="secondary"
			size="sm"
			className="h-6 gap-1 px-1.5 text-xs max-w-full"
			onClick={() => jump(anchor)}
			title={showName ? `${resourceName} · ${label}` : label}
			data-testid="comment-anchor-chip"
		>
			<Icon icon={Bookmark} className="size-3 shrink-0" />
			{showName ? (
				<>
					<span className="truncate max-w-30">{resourceName}</span>
					<span className="shrink-0 text-muted-foreground">·</span>
					<span className="shrink-0">{label}</span>
				</>
			) : (
				<span className="truncate">{label}</span>
			)}
		</Button>
	)
}

function useResourceName(anchor: ResAnchor): string {
	const resourceQuery = useQuery(resDetailCardQueryOptions(anchor.resId))
	return resourceQuery.data?.name ?? ""
}

function useAnchorLabel(anchor: ResAnchor): string {
	const { i18n } = useTranslation()
	const locale = i18n.language
	const resourceQuery = useQuery(resDetailCardQueryOptions(anchor.resId))
	const pluginListQuery = useQuery(pluginListAllQueryOptions())
	const pluginId = resourceQuery.data?.contentPluginId
	const manifest = pluginListQuery.data?.find(
		(p) => p.id === pluginId,
	)?.manifest
	const template = manifest?.ui?.message?.anchor
	if (template === undefined) return ""

	const rendered = renderCardTemplate(
		template,
		{
			file: undefined,
			source: undefined,
			searchMeta: undefined,
			data: anchor.data,
		},
		{
			locale,
			pluginId: pluginId ?? "",
			manifest: manifest ?? {},
			renderIcon: (ref, className) => RenderIcon({ icon: ref, className }),
			buildAssetUrl: buildPluginAssetUrl,
		},
	)
	if (rendered === null || rendered === undefined) return ""
	if (typeof rendered === "string") return rendered
	if (Array.isArray(rendered)) {
		const allStrings = rendered.every((r) => typeof r === "string")
		if (allStrings) return (rendered as readonly string[]).join("")
	}
	return ""
}
