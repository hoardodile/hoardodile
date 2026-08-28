import type { ResCard } from "@hoardodile/schemas"
import { AltArrowLeft, AltArrowRight } from "@hoardodile/ui/icons/registry"
import { pageCountOf } from "@hoardodile/ui/lib/pagination"
import {
	keepPreviousData,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type {
	PreviewWindowFlip,
	PreviewWindowNeighbor,
} from "@/features/plugin/iframe/use-iframe-slot"
import { previewInitContextQueryOptions } from "@/features/plugin/pluginApi"
import { resDetailCardQueryOptions, resFilesQueryOptions } from "../api"
import { ResPreviewDialog } from "./ResPreviewDialog"

type CrossPageDirection = "prev" | "next"

type PendingCrossPage = {
	readonly dir: CrossPageDirection
	readonly rowsKeyBefore: string
}

function rowsKeyOf(rows: readonly Pick<ResCard, "id">[]): string {
	return rows.map((r) => r.id).join("|")
}

function startCrossPage(
	dir: CrossPageDirection,
	rowsKeyBefore: string,
): PendingCrossPage {
	return { dir, rowsKeyBefore }
}

type ResolveCrossPageResult = {
	readonly nextPreviewId?: string
	readonly clearPending: boolean
}

/** Direction of the last prev/next flip; drives the lookahead bias. */
export type FlipDirection = "prev" | "next"

/**
 * The resIds handed to the preview window as resident iframes, biased
 * toward the travel direction: once the user flips one way, the slot
 * two steps ahead joins the window so rapid repeat flips stay instant.
 * No direction yet (fresh open, direct jump): symmetric ±1.
 */
export function visibleNeighbors(
	rows: readonly Pick<ResCard, "id" | "contentPluginId" | "previewPluginId">[],
	index: number,
	direction: FlipDirection | undefined,
): PreviewWindowNeighbor[] {
	if (index < 0) return []
	const indexes =
		direction === "next"
			? [index - 1, index + 1, index + 2]
			: direction === "prev"
				? [index - 2, index - 1, index + 1]
				: [index - 1, index + 1]
	const list: PreviewWindowNeighbor[] = []
	for (const idx of indexes) {
		const row = rows[idx]
		const pluginId = row?.previewPluginId ?? row?.contentPluginId ?? null
		if (row === undefined || pluginId === null) continue
		list.push({ resId: row.id, pluginId })
	}
	return list
}

/**
 * Resolves the target preview id after a cross-page navigation.
 *
 * Important: when list queries use placeholder/keep-previous-data, `rows` may
 * still reflect the previous page immediately after changing `page`.
 * We therefore wait until `rowsKey` differs from `rowsKeyBefore`.
 */
function resolveCrossPage(args: {
	readonly pending: PendingCrossPage | undefined
	readonly previewOpen: boolean
	readonly rows: readonly Pick<ResCard, "id">[]
	readonly rowsKey: string
	readonly previewId: string
}): ResolveCrossPageResult {
	const { pending, previewOpen, rows, rowsKey, previewId } = args

	if (pending === undefined) return { clearPending: false }
	if (!previewOpen) return { clearPending: false }
	if (rows.length === 0) return { clearPending: false }

	if (rowsKey === pending.rowsKeyBefore) return { clearPending: false }

	const target =
		pending.dir === "next" ? rows[0]?.id : rows[rows.length - 1]?.id

	if (target === undefined || target === previewId)
		return { clearPending: true }

	return { nextPreviewId: target, clearPending: true }
}

export type ResSearchPreviewDialogProps = {
	readonly rows: readonly ResCard[]
	readonly page: number
	readonly size: number
	readonly total: number
	/**
	 * Infinite (masonry) mode: `rows` are already the accumulated cross-page
	 * list. Prev/next then navigate within those loaded rows only — never
	 * across a page boundary — so the cross-page bootstrap (`resolveCrossPage`)
	 * is bypassed.
	 */
	readonly infinite?: boolean
	readonly previewId: string
	readonly onChangePreviewId: (id: string) => void
	readonly onChangePage: (page: number) => void
}

export function ResSearchPreviewDialog(props: ResSearchPreviewDialogProps) {
	const { rows, page, size, total, previewId, infinite } = props
	const { t } = useTranslation()
	const previewOpen = previewId !== ""
	const pageCount = pageCountOf(total, size)
	const rowsKey = rowsKeyOf(rows)

	// `keepPreviousData` is desirable for prev/next navigation (avoids
	// flashing empty content while the next card's detail loads), but on a
	// fresh open it leaks the previous preview's card data — the dialog
	// would mount with the stale resId/contentPluginId, claim a plugin
	// iframe for it, then re-render once the new query resolves. Gate the
	// placeholder so it only kicks in while the dialog is already open.
	const wasPreviewOpenRef = useRef(false)
	const wasPreviewOpen = wasPreviewOpenRef.current
	useEffect(() => {
		wasPreviewOpenRef.current = previewOpen
	}, [previewOpen])

	const previewCardQuery = useQuery({
		...resDetailCardQueryOptions(previewId),
		enabled: previewOpen,
		placeholderData: wasPreviewOpen ? keepPreviousData : undefined,
	})
	const previewCard = previewCardQuery.data

	const previewIndex = previewOpen
		? rows.findIndex((r) => r.id === previewId)
		: -1

	const canPrev =
		infinite === true
			? previewOpen && previewIndex > 0
			: previewOpen && (previewIndex > 0 || (previewIndex === 0 && page > 1))
	const canNext =
		infinite === true
			? previewOpen && previewIndex >= 0 && previewIndex < rows.length - 1
			: previewOpen &&
				(previewIndex >= 0
					? previewIndex < rows.length - 1 ||
						(previewIndex === rows.length - 1 && page < pageCount)
					: page < pageCount)

	const [pendingCrossPage, setPendingCrossPage] = useState<
		PendingCrossPage | undefined
	>(undefined)

	// Mirror of the preview window's synchronous flip handle: calling
	// flipNow in the click handler presents an already-painted neighbor
	// iframe in the same frame as the chrome update below, instead of
	// waiting a beat for the claim/effect chain.
	const windowRef = useRef<PreviewWindowFlip | null>(null)

	// Lookahead bias for the resident window: after the first flip the
	// window extends one extra slot in the travel direction (see
	// visibleNeighbors), so rapid repeat flips stay instant. Resets when
	// the dialog closes — a fresh open has no direction yet.
	const [lastDirection, setLastDirection] = useState<FlipDirection | undefined>(
		undefined,
	)
	useEffect(() => {
		if (!previewOpen) setLastDirection(undefined)
	}, [previewOpen])

	// The neighbors of the previewed resource, handed to the preview
	// window so each gets a resident, pre-painted iframe stacked over the
	// placeholder. Same-plugin neighbors included: in the window model
	// every resource gets its own iframe, so a same-plugin switch is a
	// style flip too, not an in-place tree swap.
	const neighbors = useMemo<PreviewWindowNeighbor[]>(
		() =>
			previewOpen ? visibleNeighbors(rows, previewIndex, lastDirection) : [],
		[previewOpen, rows, previewIndex, lastDirection],
	)

	// Warm the window's resources while the current one is on screen: the
	// detail card (instant dialog chrome), the file list (instant
	// listFiles for the plugin through the bridge's query cache), and the
	// plugin bootstrap context. The preview window's context loaders
	// consume these via fetchQuery.
	const qc = useQueryClient()
	useEffect(() => {
		for (const neighbor of neighbors) {
			void qc.prefetchQuery(resDetailCardQueryOptions(neighbor.resId))
			void qc.prefetchQuery(resFilesQueryOptions(neighbor.resId))
			void qc.prefetchQuery(
				previewInitContextQueryOptions({
					pluginId: neighbor.pluginId,
					resId: neighbor.resId,
				}),
			)
		}
	}, [qc, neighbors])

	useEffect(() => {
		const resolved = resolveCrossPage({
			pending: pendingCrossPage,
			previewOpen,
			rows,
			rowsKey,
			previewId,
		})
		if (resolved.nextPreviewId !== undefined) {
			props.onChangePreviewId(resolved.nextPreviewId)
		}
		if (resolved.clearPending) setPendingCrossPage(undefined)
	}, [pendingCrossPage, rows, rowsKey, previewId, previewOpen])

	function closePreview() {
		props.onChangePreviewId("")
		setPendingCrossPage(undefined)
	}

	function goPrev() {
		if (!previewOpen) return
		setLastDirection("prev")
		if (previewIndex > 0) {
			const target = rows[previewIndex - 1]?.id
			if (target !== undefined) {
				// Flip the content synchronously: with the neighbor already
				// painted and the detail card cached (prefetch effect above),
				// chrome and content update in the same frame.
				windowRef.current?.flipNow(target)
				props.onChangePreviewId(target)
			}
			return
		}
		if (infinite !== true && page > 1) {
			setPendingCrossPage(startCrossPage("prev", rowsKey))
			props.onChangePage(Math.max(1, page - 1))
		}
	}

	function goNext() {
		if (!previewOpen) return
		setLastDirection("next")
		if (previewIndex >= 0 && previewIndex < rows.length - 1) {
			const target = rows[previewIndex + 1]?.id
			if (target !== undefined) {
				windowRef.current?.flipNow(target)
				props.onChangePreviewId(target)
			}
			return
		}
		if (infinite !== true && page < pageCount) {
			setPendingCrossPage(startCrossPage("next", rowsKey))
			props.onChangePage(Math.min(pageCount, page + 1))
		}
	}

	// Belt-and-braces: even with `placeholderData` gated by `wasPreviewOpen`,
	// a stray previous-card payload should never paint with the new
	// previewId. If id doesn't match, treat as "still loading".
	if (!previewOpen || previewCard === undefined) {
		return null
	}

	return (
		<ResPreviewDialog
			open={previewOpen}
			onOpenChange={(next) => {
				if (!next) closePreview()
			}}
			resId={previewCard.id}
			resName={previewCard.name}
			contentPluginId={previewCard.contentPluginId ?? ""}
			previewPluginId={previewCard.previewPluginId}
			sourceMeta={previewCard.sourceMeta}
			searchMeta={previewCard.searchMeta}
			fileStats={previewCard.fileStats}
			neighbors={neighbors}
			windowRef={windowRef}
			bottomBar={
				<div className="w-30 flex items-center justify-between gap-2 px-3 py-2 m-auto">
					<button
						type="button"
						disabled={!canPrev}
						onClick={goPrev}
						aria-label={t("common.prev")}
						className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 disabled:opacity-30"
						data-testid="res-search-preview-prev"
					>
						<AltArrowLeft className="size-5" />
					</button>
					<button
						type="button"
						disabled={!canNext}
						onClick={goNext}
						aria-label={t("common.next")}
						className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 disabled:opacity-30"
						data-testid="res-search-preview-next"
					>
						<AltArrowRight className="size-5" />
					</button>
				</div>
			}
		/>
	)
}
