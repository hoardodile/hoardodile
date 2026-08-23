import { cn } from "@hoardodile/ui/lib/utils"
import { memo } from "react"
import { useTranslation } from "react-i18next"
import { useDateFormatter } from "@/features/settings/datePrefs"
import { formatDurationMs } from "@/lib/formatDuration"

export type DocExposureMeta = {
	readonly viewCount: number
	readonly totalMs: number
	readonly lastViewedAt: number | null
}

export type DocDetailMetaProps = {
	readonly charCount: number
	/**
	 * Exposure stats from `usageEntityExposureQueryOptions`. While the query
	 * is pending (or when the document was never viewed) only the char-count
	 * segment renders — the row itself never disappears.
	 */
	readonly exposure: DocExposureMeta | undefined
	readonly className?: string
}

/**
 * Single muted meta line under the document title: char count, then
 * watched time / view count / last-viewed time once exposure stats are
 * available. Replaces the standalone EntityUsageStats row on the document
 * detail page.
 */
export const DocDetailMeta = memo(function DocDetailMeta(
	props: DocDetailMetaProps,
) {
	const { charCount, exposure } = props
	const { t } = useTranslation()
	const formatter = useDateFormatter()

	const segments = [t("documents.detailMeta.chars", { count: charCount })]
	if (exposure !== undefined && exposure.viewCount > 0) {
		segments.push(
			t("usage.entityExposure.totalTime", {
				duration: formatDurationMs(exposure.totalMs),
			}),
			t("usage.entityExposure.views", { count: exposure.viewCount }),
		)
		if (exposure.lastViewedAt !== null) {
			segments.push(
				t("usage.entityExposure.lastViewed", {
					time: formatter.formatDateTime(exposure.lastViewedAt),
				}),
			)
		}
	}

	return (
		<p
			className={cn("text-[13px] text-muted-foreground", props.className)}
			data-testid="document-detail-meta"
		>
			{segments.join(" · ")}
		</p>
	)
})
