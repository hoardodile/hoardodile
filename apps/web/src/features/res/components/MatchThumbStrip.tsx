import { useTranslation } from "react-i18next"
import { resFileUrl } from "../api"

/** One matched file in a similarity strip (name + optional strength). */
export type MatchFile = {
	readonly scope: string
	readonly bits?: number
	readonly distance?: number
}

/** Hamming-distance similarity as a 0–100 percentage (mainstream dup-tool style). */
export function similarityPercent(bits: number, distance: number): number {
	return Math.round(((bits - distance) / bits) * 100)
}

/**
 * Best-match similarity of a matched-files list: the file with the
 * smallest Hamming distance wins. `undefined` when no file carries
 * distance data (exact-duplicate matches).
 */
export function bestMatchSimilarity(
	files: readonly MatchFile[],
): number | undefined {
	let best: { readonly bits: number; readonly distance: number } | undefined
	for (const file of files) {
		if (file.bits === undefined || file.distance === undefined) continue
		if (best === undefined || file.distance < best.distance) {
			best = { bits: file.bits, distance: file.distance }
		}
	}
	if (best === undefined) return undefined
	return similarityPercent(best.bits, best.distance)
}

const MAX_SHOWN_THUMBS = 6

/**
 * Compact strip of per-file previews for matched files. Filenames are
 * often meaningless (uploads are renumbered 1, 2, 3), so the thumbnails
 * are the identification surface — names and similarity percentages
 * live in each thumb's tooltip.
 */
export function MatchThumbStrip(props: {
	readonly resId: string
	readonly files: readonly MatchFile[]
}) {
	const { t } = useTranslation()
	const { resId, files } = props
	const shown = files.slice(0, MAX_SHOWN_THUMBS)
	const hiddenCount = files.length - shown.length
	return (
		<div className="flex flex-wrap gap-1.5" data-testid="match-thumb-strip">
			{shown.map((file) => (
				<img
					key={file.scope}
					src={`${resFileUrl(resId, file.scope)}?size=preview`}
					alt={file.scope}
					title={thumbTitle(file)}
					className="size-11 rounded-md object-cover"
					loading="lazy"
					decoding="async"
				/>
			))}
			{hiddenCount > 0 ? (
				<span className="flex size-11 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
					+{hiddenCount}
				</span>
			) : null}
		</div>
	)

	function thumbTitle(file: MatchFile): string {
		if (file.bits === undefined || file.distance === undefined)
			return file.scope
		return t("resources.detail.sidebar.matchSimilarity", {
			name: file.scope,
			percent: similarityPercent(file.bits, file.distance),
		})
	}
}
