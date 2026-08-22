import type { RefObject } from "react"
import type { ResCardListResult } from "@/features/res/api"
import { ResCard } from "@/features/res/components/ResCard"
import { Marquee, type MarqueeHandle } from "./Marquee"

export type ResCardMarqueeStripProps = {
	readonly rows: ResCardListResult["rows"]
	readonly isPending?: boolean
	/** Shown in place of the strip when there are no rows. */
	readonly emptyLabel?: string
	readonly stripRef?: RefObject<MarqueeHandle | null>
	/** Uniform card height; cards scale their width to the cover ratio. */
	readonly thumbHeightPx?: number
	readonly skeletonCount?: number
	readonly testId?: string
	readonly skeletonTestId?: string
}

/**
 * The resource cover strip shared by the overview pinned section, the
 * overview activity tab and detail-page "Latest resources": a pending
 * skeleton row, an empty label, or the stepping {@link Marquee} of
 * fit-height {@link ResCard}s.
 */
export function ResCardMarqueeStrip(props: ResCardMarqueeStripProps) {
	const {
		rows,
		isPending = false,
		emptyLabel,
		stripRef,
		thumbHeightPx = 240,
		skeletonCount = 8,
		testId,
		skeletonTestId,
	} = props

	return (
		<div className="min-w-0" data-testid={testId}>
			{isPending ? (
				<div
					className="flex w-fit max-w-full gap-4 no-scrollbar overflow-x-auto pb-2"
					data-testid={skeletonTestId}
				>
					{Array.from({ length: skeletonCount }, (_, i) => (
						<div key={i} className="shrink-0">
							<div
								className="animate-pulse rounded-xl bg-muted"
								style={{ height: thumbHeightPx, width: thumbHeightPx }}
							/>
						</div>
					))}
				</div>
			) : rows.length === 0 ? (
				emptyLabel !== undefined ? (
					<p className="text-sm text-muted-foreground">{emptyLabel}</p>
				) : null
			) : (
				<Marquee ref={stripRef}>
					{rows.map((resource) => (
						<div key={resource.id} className="flex items-start">
							<ResCard resource={resource} thumbFitHeight={thumbHeightPx} />
						</div>
					))}
				</Marquee>
			)}
		</div>
	)
}
