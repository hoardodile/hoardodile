import type { DocNode } from "@hoardodile/schemas"
import { SectionLabel } from "@hoardodile/ui/components/section-label"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { docWorkspaceQueryOptions } from "@/features/doc"
import { useDocsHomeLastOpened } from "@/features/doc/hooks/useDocsHomeLastOpened"
import { useRelativeTime } from "@/features/overview/hooks/useRelativeTime"

export const Route = createFileRoute("/documents/")({
	pendingComponent: () => null,
	pendingMinMs: 0,
	component: DocsIndex,
})

type DocSection = {
	/** Folder label; `undefined` for documents living at the root. */
	readonly label: string | undefined
	readonly rows: readonly { id: string; title: string; updatedAt: number }[]
}

/**
 * Landing view shown when no document is selected — the documents
 * index: a serif "Documents" title with its count line and a short
 * hairline, then one section per folder of dotted-leader rows (document
 * title … relative update time). The tree itself lives in the shell
 * sidebar; this canvas is the reading list.
 */
function DocsIndex() {
	const { t } = useTranslation()
	const relativeTime = useRelativeTime()
	useDocsHomeLastOpened()
	const workspace = useQuery(docWorkspaceQueryOptions())
	const nodes = workspace.data?.tree ?? []
	const isLoading = workspace.isPending

	const sections = useMemo(() => buildDocSections(nodes), [nodes])
	const folderCount = useMemo(
		() => nodes.filter((node) => node.kind === "folder").length,
		[nodes],
	)
	const docCount = useMemo(
		() => nodes.filter((node) => node.kind === "document").length,
		[nodes],
	)

	return (
		<div className="px-8 pt-16 pb-24">
			<div className="mx-auto flex w-full max-w-reading flex-col">
				<h1 className="font-doc text-doc-title font-bold text-foreground">
					{t("documents.title")}
				</h1>
				<p className="mt-3 text-ui text-muted-foreground">
					{t("documents.index.description", {
						docs: t("documents.index.docCount", { count: docCount }),
						folders: t("documents.index.folderCount", {
							count: folderCount,
						}),
					})}
				</p>
				<div className="mt-6 mb-8 h-px w-32 bg-border" />

				{isLoading ? (
					<div className="flex flex-col">
						{Array.from({ length: 4 }, (_, i) => (
							<div key={i} className="flex h-9 items-baseline gap-3">
								<span className="h-4 w-1/3 animate-pulse rounded bg-muted" />
							</div>
						))}
					</div>
				) : sections.length === 0 ? (
					<p className="text-ui text-muted-foreground">
						{t("documents.listEmpty")}
					</p>
				) : (
					sections.map((section, index) => (
						<div
							key={section.label ?? "__root__"}
							className={index === 0 ? "" : "mt-8"}
						>
							{section.label !== undefined ? (
								<div className="mb-2 flex items-baseline justify-between">
									<SectionLabel>{section.label}</SectionLabel>
								</div>
							) : null}
							{section.rows.map((row) => (
								<Link
									to="/documents/$id"
									params={{ id: row.id }}
									key={row.id}
									className="group flex h-9 w-full cursor-pointer items-baseline gap-3 text-left"
								>
									<span className="font-doc text-lg leading-[1.4] whitespace-nowrap text-secondary-foreground group-hover:text-foreground">
										{row.title}
									</span>
									<span className="min-w-6 flex-1 -translate-y-[5px] border-b border-dotted border-border-strong" />
									<span className="text-xs whitespace-nowrap text-muted-foreground">
										{t("documents.index.updated", {
											time: relativeTime(row.updatedAt),
										})}
									</span>
								</Link>
							))}
						</div>
					))
				)}
			</div>
		</div>
	)
}

/**
 * Flatten the flat parentId-keyed tree into sections: every folder
 * becomes a section with its direct document children; documents at the
 * root render in a label-less first section.
 */
function buildDocSections(nodes: readonly DocNode[]): readonly DocSection[] {
	const byParent = new Map<string | undefined, DocNode[]>()
	for (const node of nodes) {
		const bucket = byParent.get(node.parentId)
		if (bucket === undefined) byParent.set(node.parentId, [node])
		else bucket.push(node)
	}

	const sections: DocSection[] = []
	const rootDocs = (byParent.get(undefined) ?? []).filter(
		(node) => node.kind === "document",
	)
	if (rootDocs.length > 0) {
		sections.push({ label: undefined, rows: rootDocs })
	}

	function walk(parentId: string | undefined) {
		for (const node of byParent.get(parentId) ?? []) {
			if (node.kind !== "folder") continue
			const rows = (byParent.get(node.id) ?? []).filter(
				(child) => child.kind === "document",
			)
			if (rows.length > 0) sections.push({ label: node.title, rows })
			walk(node.id)
		}
	}
	walk(undefined)

	return sections
}
