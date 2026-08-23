import { SectionHeader } from "@hoardodile/ui/components/section-header"
import { DocumentText, Folder } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { docSearchQueryOptions } from "@/features/doc/api"
import { loose } from "@/i18n"

export type LinkedDocumentsSectionProps = (
	| { readonly charIds: readonly string[] }
	| { readonly resIds: readonly string[] }
) & {
	/** Section title key, per entity ("In documents"). */
	readonly titleKey: string
}

const LINKED_DOC_LIMIT = 100

/**
 * Linked documents as a three-column grid of unbordered title rows —
 * the DocumentsSection anatomy (search lives on the documents page).
 * "View all" jumps to the documents page with the entity pre-applied
 * as a filter. Shared by the character and resource detail pages.
 */
export function LinkedDocumentsSection(props: LinkedDocumentsSectionProps) {
	const { titleKey } = props
	const { t } = useTranslation()
	const navigate = useNavigate()
	const scope =
		"charIds" in props
			? { charIds: [...props.charIds] }
			: { resIds: [...props.resIds] }
	const docsQ = useQuery(
		docSearchQueryOptions({
			query: undefined,
			size: LINKED_DOC_LIMIT,
			...scope,
		}),
	)
	const rows = docsQ.data?.rows ?? []
	if (rows.length === 0) return null
	const viewAllSearch =
		"charIds" in props
			? { charIds: [...props.charIds] }
			: { resIds: [...props.resIds] }
	return (
		<section data-testid="linked-documents">
			<SectionHeader
				icon={DocumentText}
				title={loose(t)(titleKey)}
				count={String(rows.length)}
				viewAll={t("documents.viewAll")}
				onViewAll={() =>
					void navigate({ to: "/documents", search: viewAllSearch })
				}
			/>
			<div className="mt-3 grid grid-cols-3 gap-x-8 gap-y-3">
				{rows.map((row) => {
					const isFolder = row.kind === "folder"
					const Icon = isFolder ? Folder : DocumentText
					const inner = (
						<>
							<Icon className="size-4 shrink-0 text-secondary-foreground" />
							<span className="truncate">{row.title}</span>
						</>
					)
					return isFolder ? (
						<span
							key={row.id}
							className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
						>
							{inner}
						</span>
					) : (
						<Link
							key={row.id}
							to="/documents/$id"
							params={{ id: row.id }}
							className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 text-sm text-secondary-foreground transition-colors duration-150 hover:bg-muted"
							data-testid={`linked-document-${row.id}`}
						>
							{inner}
						</Link>
					)
				})}
			</div>
		</section>
	)
}
