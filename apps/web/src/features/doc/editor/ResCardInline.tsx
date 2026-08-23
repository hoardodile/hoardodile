import { createReactInlineContentSpec } from "@blocknote/react"
import { Box } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { resDetailCardQueryOptions } from "@/features/res/api"
import { ResMediaThumb } from "@/features/res/components/ResMediaThumb"
import { ResPreviewDialog } from "@/features/res/components/ResPreviewDialog"

const MIN_HEIGHT_PX = 120
const MAX_HEIGHT_PX = 600
const MAX_WIDTH_PX = 400

/**
 * Inline `resCard`: bare resource thumbnail (cover + media-type and
 * file-count corner pills) shown alongside surrounding text.
 *
 * Visual core comes from {@link ResMediaThumb} so embedded resources match
 * the resources page card. Persists only the resource id; everything else is
 * fetched live via `resource.detailCard`.
 */
export const resCardInlineSpec = createReactInlineContentSpec(
	{
		type: "resCard",
		propSchema: {
			resId: { default: "" },
		},
		content: "none",
	},
	{
		render: (props) => {
			const id = props.inlineContent.props.resId
			return <ResCardView resId={id} />
		},
		toExternalHTML: (props) => {
			const id = props.inlineContent.props.resId
			return <ResCardExternal resId={id} />
		},
	},
)

type ResCardViewProps = {
	readonly resId: string
}

function ResCardView(props: ResCardViewProps) {
	const { t } = useTranslation()
	const enabled = props.resId.length > 0
	const query = useQuery({
		...resDetailCardQueryOptions(props.resId),
		enabled,
	})
	const [previewOpen, setPreviewOpen] = useState(false)
	if (!enabled) {
		return (
			<span
				contentEditable={false}
				className="inline-flex items-center gap-1 rounded-md border border-dashed bg-muted/30 px-2 py-1 text-xs text-muted-foreground align-middle"
			>
				<Box className="size-3.5" />
				<span>{t("resources.detail.emptyInline")}</span>
			</span>
		)
	}
	const card = query.data
	if (query.isLoading || card === undefined) {
		return (
			<span
				contentEditable={false}
				className="inline-flex items-center gap-1 rounded-md border bg-muted/30 px-2 py-1 text-xs text-muted-foreground animate-pulse align-middle"
			>
				<Box className="size-3.5" />
				<span>{t("common.loading")}</span>
			</span>
		)
	}
	return (
		<span
			contentEditable={false}
			data-resource-card
			title={card.name}
			className="inline-block align-middle mx-0.5"
		>
			<ResMediaThumb
				resource={card}
				maxWidth={MAX_WIDTH_PX}
				maxHeight={MAX_HEIGHT_PX}
				minHeight={MIN_HEIGHT_PX}
				// No-cover embeds fall back to a square tile; without the
				// width floor the box would collapse (the thumb's only
				// in-flow content is the cover image).
				minWidth={MIN_HEIGHT_PX}
				onPreviewRequest={() => setPreviewOpen(true)}
				onVideoZoomRequest={() => setPreviewOpen(true)}
			/>
			<ResPreviewDialog
				open={previewOpen}
				onOpenChange={setPreviewOpen}
				resId={card.id}
				resName={card.name}
				contentPluginId={card.contentPluginId ?? ""}
				previewPluginId={card.previewPluginId}
				sourceMeta={card.sourceMeta}
				searchMeta={card.searchMeta}
				fileStats={card.fileStats}
			/>
		</span>
	)
}

/**
 * Minimal external-HTML renderer for `resCard`. BlockNote uses this
 * when copying to clipboard or exporting — only the resource name
 * is rendered so pasting into external editors produces clean text.
 */
function ResCardExternal(props: ResCardViewProps) {
	const enabled = props.resId.length > 0
	const query = useQuery({
		...resDetailCardQueryOptions(props.resId),
		enabled,
	})
	const name = query.data?.name ?? props.resId
	return <span>{name}</span>
}
