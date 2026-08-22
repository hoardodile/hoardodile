import { FileText, Folder } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { docSearchQueryOptions } from "./api.ts"

export type DocSearchResultsProps = {
	readonly query: string
	readonly activeId: string | undefined
	readonly onSelect?: () => void
	/** When set, restrict to documents linked to these characters (editor chips). */
	readonly charIds?: readonly string[]
	/** When set, restrict to documents linked to these resources (editor cards). */
	readonly resIds?: readonly string[]
	/** Applied to the results list for embedded layouts (e.g. max height + scroll). */
	readonly listClassName?: string
}

/**
 * Server-driven flat results list shown in the sidebar whenever the
 * user has typed a search query. Replaces the local-only title filter
 * so content matches (LIKE on the indexed plain-text projection) are
 * authoritative.
 */
export function DocSearchResults(props: DocSearchResultsProps) {
	const { t } = useTranslation()
	const trimmed = props.query.trim()
	const charIds =
		props.charIds !== undefined && props.charIds.length > 0
			? [...props.charIds]
			: undefined
	const resIds =
		props.resIds !== undefined && props.resIds.length > 0
			? [...props.resIds]
			: undefined
	const searchInput = {
		query: trimmed.length > 0 ? trimmed : undefined,
		size: 100,
		...(charIds !== undefined ? { charIds } : {}),
		...(resIds !== undefined ? { resIds } : {}),
	}
	const search = useQuery(docSearchQueryOptions(searchInput))

	return (
		<div className="flex flex-col gap-2">
			{search.isLoading ? (
				<div className="space-y-2 px-3 py-3">
					<p className="doc-label">{t("common.loading")}</p>
					<div className="h-8 w-full animate-pulse rounded-lg bg-muted" />
					<div className="h-8 w-5/6 animate-pulse rounded-lg bg-muted" />
					<div className="h-8 w-2/3 animate-pulse rounded-lg bg-muted" />
				</div>
			) : (search.data?.rows.length ?? 0) === 0 ? (
				<div className="px-3 py-3 text-xs text-muted-foreground">
					{t("documents.search.empty")}
				</div>
			) : (
				<ul
					className={cn("flex flex-col py-0.5", props.listClassName)}
					data-testid="documents-search-results"
				>
					{search.data?.rows.map((row) => {
						const isFolder = row.kind === "folder"
						const Icon = isFolder ? Folder : FileText
						const isActive = props.activeId === row.id
						const inner = (
							<div className="h-full flex items-center gap-1.5 truncate">
								<Icon
									className="size-4 shrink-0 text-secondary-foreground"
									strokeWidth={1.6}
								/>
								<span className="truncate text-[13px] font-medium leading-none">
									{row.title}
								</span>
							</div>
						)
						return (
							<li key={row.id}>
								{isFolder ? (
									<div
										className={cn(
											"relative h-8 rounded-lg px-3 text-muted-foreground",
											isActive && "bg-muted text-foreground",
										)}
									>
										{inner}
									</div>
								) : (
									<Link
										to="/documents/$id"
										params={{ id: row.id }}
										onClick={() => props.onSelect?.()}
										className={cn(
											"relative flex h-8 items-center rounded-lg px-3",
											isActive
												? "bg-muted text-foreground"
												: "text-secondary-foreground hover:bg-muted",
										)}
										data-testid={`documents-search-open-${row.id}`}
									>
										{inner}
									</Link>
								)}
							</li>
						)
					})}
				</ul>
			)}
		</div>
	)
}
