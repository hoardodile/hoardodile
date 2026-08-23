import type {
	CharCard,
	Comment,
	DocSearchRow,
	ResCard,
	SearchGlobalResult,
} from "@hoardodile/schemas"
import { SectionHeader } from "@hoardodile/ui/components/section-header"
import { ChatSquare, DocumentText, Folder } from "@hoardodile/ui/icons/registry"
import { Link, useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { CharCard as CharacterCard } from "@/features/char/components/CharCard"
import { ResCard as ResourceCard } from "@/features/res/components/ResCard"
import { useDateFormatter } from "@/features/settings/datePrefs"
import { loose } from "@/i18n"
import { SearchHighlight } from "./SearchHighlight"
import { SearchResultRow } from "./SearchResultRow"

export type SearchResultSectionsProps = {
	readonly data: SearchGlobalResult
	readonly query: string
}

type SectionConfig = {
	readonly kind: "characters" | "resources" | "documents" | "messages"
	readonly titleKey: string
}

const SECTIONS: readonly SectionConfig[] = [
	{ kind: "characters", titleKey: "search.sectionTitles.characters" },
	{ kind: "resources", titleKey: "search.sectionTitles.resources" },
	{ kind: "documents", titleKey: "search.sectionTitles.documents" },
	{ kind: "messages", titleKey: "search.sectionTitles.messages" },
]

export function SearchResultSections(props: SearchResultSectionsProps) {
	const { data, query } = props
	const { t } = useTranslation()
	const formatter = useDateFormatter()
	const navigate = useNavigate()

	function viewAll(kind: SectionConfig["kind"]) {
		return () => {
			if (kind === "characters") {
				void navigate({ to: "/characters", search: { query } })
			} else if (kind === "resources") {
				void navigate({ to: "/resources", search: { query } })
			} else if (kind === "messages") {
				void navigate({ to: "/messages", search: { query } })
			} else {
				void navigate({ to: "/documents", search: { filter: query } })
			}
		}
	}

	return (
		<div className="flex flex-col gap-8">
			{SECTIONS.map((section) => {
				const page =
					section.kind === "characters"
						? data.characters
						: section.kind === "resources"
							? data.resources
							: section.kind === "documents"
								? data.documents
								: data.messages

				if (page.total === 0) {
					return null
				}

				return (
					<section key={section.kind} className="flex flex-col">
						<SectionHeader
							title={loose(t)(section.titleKey)}
							count={t("search.sectionCount", { count: page.total })}
							viewAll={t("search.viewAll", { count: page.total })}
							onViewAll={viewAll(section.kind)}
						/>
						{section.kind === "characters" ? (
							<ul className="mt-4 flex flex-wrap justify-around gap-4">
								{(page.rows as readonly CharCard[]).map((character) => (
									<li key={character.id}>
										<CharacterCard character={character} />
									</li>
								))}
							</ul>
						) : section.kind === "resources" ? (
							<ul className="mt-4 flex flex-wrap justify-around gap-6">
								{(page.rows as readonly ResCard[]).map((resource) => (
									<li key={resource.id}>
										<ResourceCard resource={resource} />
									</li>
								))}
							</ul>
						) : section.kind === "documents" ? (
							<div className="mt-2">
								{(page.rows as readonly DocSearchRow[]).map((doc) => (
									<DocResultRow
										key={doc.id}
										doc={doc}
										query={query}
										formatter={formatter}
									/>
								))}
							</div>
						) : (
							<div className="mt-2">
								{(page.rows as readonly Comment[]).map((message) => (
									<MessageResultRow
										key={message.id}
										message={message}
										query={query}
										formatter={formatter}
									/>
								))}
							</div>
						)}
					</section>
				)
			})}
		</div>
	)
}

type RowFormatter = ReturnType<typeof useDateFormatter>

function DocResultRow({
	doc,
	query,
	formatter,
}: {
	readonly doc: DocSearchRow
	readonly query: string
	readonly formatter: RowFormatter
}) {
	const { t } = useTranslation()
	const isFolder = doc.kind === "folder"
	return (
		<Link
			to="/documents/$id"
			params={{ id: doc.id }}
			className="block"
			data-testid={`search-result-document-${doc.id}`}
		>
			<SearchResultRow
				icon={isFolder ? Folder : DocumentText}
				title={<SearchHighlight text={doc.title} query={query} />}
				kind={
					isFolder
						? t("search.resultLabels.folder")
						: t("search.resultLabels.document")
				}
				snippet={
					doc.snippet !== undefined && doc.snippet.length > 0 ? (
						<SearchHighlight text={doc.snippet} query={query} />
					) : (
						""
					)
				}
				meta={formatter.formatDateTime(doc.updatedAt)}
			/>
		</Link>
	)
}

function MessageResultRow({
	message,
	query,
	formatter,
}: {
	readonly message: Comment
	readonly query: string
	readonly formatter: RowFormatter
}) {
	return (
		<div data-testid={`search-result-message-${message.id}`}>
			<SearchResultRow
				icon={ChatSquare}
				kind={message.floor !== undefined ? `#${message.floor}` : undefined}
				title=""
				snippet={<SearchHighlight text={message.body} query={query} />}
				meta={formatter.formatDateTime(message.createdAt)}
			/>
		</div>
	)
}
