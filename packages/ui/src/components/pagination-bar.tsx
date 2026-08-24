import { Icon } from "@hoardodile/ui/components/icon"
import { Input } from "@hoardodile/ui/components/input"
import {
	Pagination,
	PaginationContent,
	PaginationItem,
} from "@hoardodile/ui/components/pagination"
import { useBelowMd } from "@hoardodile/ui/hooks/use-mobile"
import { AltArrowLeft, AltArrowRight } from "@hoardodile/ui/icons/registry"
import { paginationWindow } from "@hoardodile/ui/lib/pagination"
import { cn } from "@hoardodile/ui/lib/utils"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export type PaginationBarProps = {
	readonly page: number
	readonly pageCount: number
	readonly onChangePage: (page: number) => void
	/** Result-count label rendered in the left slot (e.g. "56 messages"). */
	readonly totalLabel: string
}

const pageButton =
	"flex h-control min-w-8 cursor-pointer items-center justify-center rounded-lg px-2 text-xs"

/**
 * The paginator: the result count on the left, balanced by the page-jump
 * field on the right, and the centered row of h-control page chips —
 * chevrons, first and last page always visible with an asymmetric window
 * around the active page (one leading, two trailing) and ellipses for the
 * gap (see {@link paginationWindow}). Below the md breakpoint the window
 * collapses to a compact `page/total` chip, so narrow screens still see
 * how many pages exist. Shared by every paged list (resources,
 * characters, comments, stats, footprints).
 */
export function PaginationBar(props: PaginationBarProps) {
	const { page, pageCount, onChangePage, totalLabel } = props
	const { t } = useTranslation("ui", { useSuspense: false })
	const [draft, setDraft] = useState("")
	const isMobile = useBelowMd()

	function jump(): void {
		const parsed = Number.parseInt(draft, 10)
		if (Number.isNaN(parsed)) return
		const clamped = Math.min(Math.max(1, parsed), pageCount)
		setDraft("")
		if (clamped !== page) onChangePage(clamped)
	}

	const pages = isMobile ? [page] : paginationWindow(page, pageCount)
	const chip = (active: boolean) =>
		cn(
			pageButton,
			active
				? "bg-muted font-medium text-foreground"
				: "text-muted-foreground enabled:hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
		)

	return (
		<Pagination data-testid="pagination-bar">
			<div className="flex w-full items-center gap-2">
				<span className="w-28 shrink-0 truncate text-xs text-muted-foreground">
					{totalLabel}
				</span>
				<PaginationContent className="flex-1 justify-center">
					<PaginationItem>
						<button
							type="button"
							className={chip(false)}
							disabled={page <= 1}
							aria-label={t("pagination.prev")}
							onClick={() => onChangePage(page - 1)}
						>
							<Icon icon={AltArrowLeft} />
						</button>
					</PaginationItem>
					{pages.map((entry, index) =>
						entry === "…" ? (
							<PaginationItem key={`ellipsis-${index}`}>
								<span className="px-1 text-xs text-muted-foreground">
									{entry}
								</span>
							</PaginationItem>
						) : (
							<PaginationItem key={entry}>
								<button
									type="button"
									className={chip(entry === page)}
									data-testid={
										entry === page ? "pagination-current" : undefined
									}
									onClick={() => onChangePage(entry)}
								>
									{isMobile ? `${page}/${pageCount}` : entry}
								</button>
							</PaginationItem>
						),
					)}
					<PaginationItem>
						<button
							type="button"
							className={chip(false)}
							disabled={page >= pageCount}
							aria-label={t("pagination.next")}
							onClick={() => onChangePage(page + 1)}
						>
							<Icon icon={AltArrowRight} />
						</button>
					</PaginationItem>
				</PaginationContent>
				<form
					className="flex w-28 items-center justify-end gap-1.5 text-xs text-muted-foreground"
					onSubmit={(event) => {
						event.preventDefault()
						jump()
					}}
				>
					<span className="shrink-0 whitespace-nowrap">{t("pagination.goTo")}</span>
					<Input
						type="number"
						min={1}
						max={pageCount}
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						placeholder={t("pagination.jumpToPage")}
						aria-label={t("pagination.goTo")}
						size="sm"
						// Content-elastic width in `ch` units (the native `size`
						// attribute's modern equivalent — `field-sizing` is not
						// supported everywhere yet): one character per digit,
						// with room for the "Page" placeholder and padding.
						style={{ width: `${Math.max(4, draft.length + 2) + 4}ch` }}
						className="min-w-0 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
					/>
				</form>
			</div>
		</Pagination>
	)
}
