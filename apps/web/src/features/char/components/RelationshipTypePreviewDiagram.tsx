import { cn } from "@hoardodile/ui/lib/utils"
import { useId, useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
	buildPreviewDiagramCards,
	type PreviewCharacterCard,
	resolvePreviewDiagramLayout,
} from "../utils/relationshipTypePreview"
import type { RelationshipTypeFormDraft } from "./RelationshipTypeFormFields"

type Props = {
	readonly draft: RelationshipTypeFormDraft
}

function PreviewCharacterCardView(props: {
	readonly card: PreviewCharacterCard
}) {
	const { card } = props
	const label =
		card.relationshipLabel.trim().length > 0 ? card.relationshipLabel : "—"
	return (
		<div className="flex w-24 flex-col items-center gap-0.5 rounded-md border bg-card px-1.5 py-1.5 shadow-sm">
			<span className="max-w-full truncate text-xs font-medium">
				{card.characterLabel}
			</span>
			<span
				className="max-w-full truncate rounded bg-muted/55 px-1 py-0.5 text-tiny text-foreground/90"
				data-testid={
					card.role === "self"
						? "relationship-preview-self-label"
						: "relationship-preview-target-label"
				}
			>
				{label}
			</span>
		</div>
	)
}

function PreviewConnector(props: {
	readonly orientation: "horizontal" | "vertical"
	readonly bidirectional: boolean
}) {
	const { orientation, bidirectional } = props
	const uid = useId().replace(/:/g, "")
	const endId = `preview-arrow-end-${uid}`
	const startId = `preview-arrow-start-${uid}`
	const isHorizontal = orientation === "horizontal"

	const markerEnd = (
		<marker
			id={endId}
			markerWidth="7"
			markerHeight="7"
			refX="5.5"
			refY="3.5"
			orient="auto"
			markerUnits="strokeWidth"
		>
			<path
				d="M0.5 0.5 L6 3.5 L0.5 6.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.25"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</marker>
	)

	const markerStart = (
		<marker
			id={startId}
			markerWidth="7"
			markerHeight="7"
			refX="0.5"
			refY="3.5"
			orient="auto"
			markerUnits="strokeWidth"
		>
			<path
				d="M6.5 0.5 L1 3.5 L6.5 6.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.25"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</marker>
	)

	if (isHorizontal) {
		return (
			<svg
				viewBox="0 0 56 16"
				className="h-4 w-12 shrink-0 text-foreground/55"
				aria-hidden
			>
				<defs>
					{markerEnd}
					{bidirectional ? markerStart : null}
				</defs>
				<path
					d="M 4 8 C 18 5.5, 38 10.5, 52 8"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.75"
					strokeLinecap="round"
					markerEnd={`url(#${endId})`}
					markerStart={bidirectional ? `url(#${startId})` : undefined}
				/>
				{bidirectional ? (
					<circle cx="28" cy="8" r="1.25" fill="currentColor" opacity="0.45" />
				) : null}
			</svg>
		)
	}

	return (
		<svg
			viewBox="0 0 16 28"
			className="h-6 w-3.5 shrink-0 text-foreground/55"
			aria-hidden
		>
			<defs>{markerEnd}</defs>
			<path
				d="M 8 2 C 10 9, 6 19, 8 26"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.75"
				strokeLinecap="round"
				markerEnd={`url(#${endId})`}
			/>
		</svg>
	)
}

export function RelationshipTypePreviewDiagram(props: Props) {
	const { draft } = props
	const { t } = useTranslation()

	const labels = useMemo(
		() => ({
			characterA: t("relationshipTypes.preview.characterA"),
			characterB: t("relationshipTypes.preview.characterB"),
		}),
		[t],
	)

	const layout = useMemo(() => resolvePreviewDiagramLayout(draft), [draft])

	const [selfCard, targetCard] = useMemo(
		() => buildPreviewDiagramCards(draft, labels),
		[draft, labels],
	)

	const orderedCards = layout.selfFirst
		? [selfCard, targetCard]
		: [targetCard, selfCard]

	return (
		<div
			className="h-40 w-full shrink-0 rounded-lg border bg-muted/15 px-3"
			data-testid="relationship-type-preview-diagram"
		>
			<div
				className={cn(
					"flex h-full items-center justify-center",
					layout.orientation === "vertical"
						? "flex-col gap-1"
						: "flex-row gap-2",
				)}
			>
				<PreviewCharacterCardView card={orderedCards[0]!} />
				<PreviewConnector
					orientation={layout.orientation}
					bidirectional={layout.bidirectional}
				/>
				<PreviewCharacterCardView card={orderedCards[1]!} />
			</div>
		</div>
	)
}
