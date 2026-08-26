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
	/** Creation time of the document (absolute, from the doc node). */
	readonly createdAt: number
	/** Last update time of the document (absolute, from the doc node). */
	readonly updatedAt: number
	/**
	 * Exposure stats from `usageEntityExposureQueryOptions`. While the query
	 * is pending (or when the document was never viewed) only the char-count
	 * segment renders — the row itself never disappears.
	 */
	readonly exposure: DocExposureMeta | undefined
	readonly className?: string
}

/**
 * Muted meta lines under the document title: the first line carries the
 * char count plus created / updated dates; the second line carries the
 * watched time / view count / last-viewed time once exposure stats are
 * available — kept on its own row so a long exposure line never crowds
 * the dates. Replaces the standalone EntityUsageStats row on the document
 * detail page.
 */
export const DocDetailMeta = memo(function DocDetailMeta(
	props: DocDetailMetaProps,
) {
	const { charCount, createdAt, updatedAt, exposure } = props
	const { t } = useTranslation()
	const formatter = useDateFormatter()

	const segments = [
		t("documents.detailMeta.chars", { count: charCount }),
		t("documents.detailMeta.created", {
			time: formatter.formatDateTime(createdAt),
		}),
		t("documents.detailMeta.updated", {
			time: formatter.formatDateTime(updatedAt),
		}),
	]

	const exposureSegments: string[] = []
	if (exposure !== undefined && exposure.viewCount > 0) {
		exposureSegments.push(
			t("usage.entityExposure.totalTime", {
				duration: formatDurationMs(exposure.totalMs),
			}),
			t("usage.entityExposure.views", { count: exposure.viewCount }),
		)
		if (exposure.lastViewedAt !== null) {
			exposureSegments.push(
				t("usage.entityExposure.lastViewed", {
					time: formatter.formatDateTime(exposure.lastViewedAt),
				}),
			)
		}
	}

	return (
		<div
			className={cn("text-[13px] text-muted-foreground", props.className)}
			data-testid="document-detail-meta"
		>
			<p>{segments.join(" · ")}</p>
			{exposureSegments.length > 0 ? (
				<p className="mt-0.5" data-testid="document-detail-meta-exposure">
					{exposureSegments.join(" · ")}
				</p>
			) : null}
		</div>
	)
})
