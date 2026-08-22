import { cn } from "@hoardodile/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import {
	createFileRoute,
	Outlet,
	useChildMatches,
	useNavigate,
} from "@tanstack/react-router"
import { useCallback, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { z } from "zod"
import { useClaimSidebarSlot } from "@/components/layout/sidebarSlot"
import {
	docDetailPageQueryOptions,
	docWorkspaceQueryOptions,
} from "@/features/doc"
import { DocAppearanceSettingsDialog } from "@/features/doc/components/DocAppearanceSettingsDialog"
import { DocFilterDialog } from "@/features/doc/components/DocFilterDialog"
import { SidebarTopSection } from "@/features/doc/components/SidebarTopSection"
import {
	DocLayoutContext,
	type DocLayoutValue,
} from "@/features/doc/DocLayoutContext"
import { DocSearchResults } from "@/features/doc/DocSearchResults"
import { DocTrashList } from "@/features/doc/DocTrashList"
import { DocTree } from "@/features/doc/DocTree"
import { useDocFontSlot } from "@/features/doc/hooks/useDocFontSlot"
import { useDocTheme } from "@/features/doc/hooks/useDocPrefs"
import { useDocsSidebarModes } from "@/features/doc/hooks/useDocsSidebarModes"
import { useDocTreeExpansion } from "@/features/doc/hooks/useDocTreeExpansion"
import { asyncPrefQueryOptions } from "@/features/prefs/asyncPrefQuery"
import { requireAuth } from "@/lib/auth-guard"
import { DOC_PAGE_FONT_TAGS } from "@/lib/fonts"
import { prefKeys } from "@/lib/keys"

const docsSearchSchema = z
	.object({
		filter: z.string().optional(),
		/** Character/resource scope (detail-page "view all" links land here). */
		charIds: z.array(z.string()).optional(),
		resIds: z.array(z.string()).optional(),
	})
	.loose()

export const Route = createFileRoute("/documents")({
	beforeLoad: requireAuth,
	validateSearch: docsSearchSchema,
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(
			asyncPrefQueryOptions(prefKeys.docTreeExpanded),
		)
	},
	component: DocsLayout,
})

/**
 * Unified knowledge-base section: the document tree module lives in the
 * AppShell's sidebar slot (claimed via {@link useClaimSidebarSlot}, which
 * suppresses the shell's default nav), the active document fills the main
 * canvas. On mobile the shell renders the same slot inside its drawer, so
 * the tree module is mounted exactly once either way.
 *
 * The layout owns the single workspace query (tree + masked AI
 * config), so child routes never refetch the tree just to render a
 * detail panel.
 */
function DocsLayout() {
	const slot = useClaimSidebarSlot()
	const activeId = useActiveDocId()
	const detailPageQuery = useQuery({
		...docDetailPageQueryOptions(activeId ?? ""),
		enabled: activeId !== undefined,
	})
	const workspaceQuery = useQuery({
		...docWorkspaceQueryOptions(),
		enabled: activeId === undefined,
	})
	const nodes = detailPageQuery.data?.tree ?? workspaceQuery.data?.tree ?? []
	const documentCount = useMemo(
		function countDocuments() {
			return nodes.filter((node) => node.kind === "document").length
		},
		[nodes],
	)
	const workspaceLoading =
		activeId !== undefined
			? detailPageQuery.isPending
			: workspaceQuery.isPending
	const search = Route.useSearch()
	const charIds = search.charIds ?? []
	const resIds = search.resIds ?? []
	const filterActive = charIds.length > 0 || resIds.length > 0
	const [appearanceDialogOpen, setAppearanceDialogOpen] = useState(false)
	const [filterDialogOpen, setFilterDialogOpen] = useState(false)
	const navigate = useNavigate()
	const handleCloseMobileTree = useCallback(function handleCloseMobileTree() {
		// no-op: the shell owns the drawer (it closes on backdrop/navigation)
	}, [])
	const { themeClass } = useDocTheme()
	const uiBodyFont = useDocFontSlot(
		prefKeys.docUiFont,
		prefKeys.docUiFontInherit,
		DOC_PAGE_FONT_TAGS,
	)
	const uiHeadingFont = useDocFontSlot(
		prefKeys.docUiHeadingFont,
		prefKeys.docUiHeadingFontInherit,
		DOC_PAGE_FONT_TAGS,
	)
	const sidebar = useDocsSidebarModes({ filter: search.filter ?? "" })
	const expansion = useDocTreeExpansion(nodes)

	const layoutValue = useMemo<DocLayoutValue>(
		function buildLayoutValue() {
			return {
				readingView: sidebar.readingView,
				toggleReadingView: sidebar.toggleReadingView,
			}
		},
		[sidebar.readingView, sidebar.toggleReadingView],
	)

	// The tree module is a single JSX tree portaled into the AppShell's
	// sidebar slot — desktop sidebar at md+, the shell's drawer below.
	const treeModule = (
		<div
			className="mt-3 flex min-h-0 flex-1 flex-col"
			data-testid="documents-sidebar"
		>
			<SidebarTopSection
				count={documentCount}
				isLoading={workspaceLoading}
				searchValue={sidebar.filter}
				onSearchChange={sidebar.setFilter}
				charIds={charIds}
				resIds={resIds}
				onOpenFilter={() => setFilterDialogOpen(true)}
				trashMode={sidebar.trashMode}
				onToggleTrash={sidebar.handleToggleTrash}
				editMode={sidebar.editMode}
				onEditModeChange={sidebar.setEditMode}
				readingView={sidebar.readingView}
				onToggleReadingView={sidebar.toggleReadingView}
				readingViewDisabled={activeId === undefined}
				onOpenAppearanceSettings={() => setAppearanceDialogOpen(true)}
				allExpanded={expansion.allExpanded}
				onToggleExpandAll={expansion.toggleExpandAll}
				hasExpandableNodes={expansion.hasExpandableNodes}
			/>
			<div className="strip-scroll mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
				{sidebar.trashMode ? (
					<DocTrashList activeId={activeId} onSelect={handleCloseMobileTree} />
				) : sidebar.isSearching || filterActive ? (
					<DocSearchResults
						query={sidebar.filter.trim()}
						activeId={activeId}
						onSelect={handleCloseMobileTree}
						charIds={charIds.length > 0 ? charIds : undefined}
						resIds={resIds.length > 0 ? resIds : undefined}
					/>
				) : (
					<DocTree
						nodes={nodes}
						activeId={activeId}
						editMode={sidebar.editMode}
						onSelect={handleCloseMobileTree}
						isLoading={workspaceLoading}
						expandedIds={expansion.expandedIds}
						onToggleExpanded={expansion.toggleExpanded}
						onExpandIds={expansion.expandIds}
					/>
				)}
			</div>
		</div>
	)

	return (
		<div
			className={cn("doc w-full", themeClass)}
			data-doc-layout
			style={
				{
					...(uiBodyFont.fontFamily
						? { "--font-doc-ui-body": uiBodyFont.fontFamily }
						: {}),
					...(uiHeadingFont.fontFamily
						? { "--font-doc-ui-heading": uiHeadingFont.fontFamily }
						: {}),
				} as React.CSSProperties
			}
		>
			{slot === null ? null : createPortal(treeModule, slot)}

			<DocLayoutContext.Provider value={layoutValue}>
				<Outlet />
			</DocLayoutContext.Provider>

			<DocAppearanceSettingsDialog
				open={appearanceDialogOpen}
				onOpenChange={setAppearanceDialogOpen}
			/>
			<DocFilterDialog
				open={filterDialogOpen}
				onOpenChange={setFilterDialogOpen}
				charIds={charIds}
				resIds={resIds}
				onApply={(nextCharIds, nextResIds) => {
					void navigate({
						to: ".",
						search: (prev) => ({
							...(prev ?? {}),
							charIds: nextCharIds.length > 0 ? nextCharIds : undefined,
							resIds: nextResIds.length > 0 ? nextResIds : undefined,
						}),
						replace: true,
					})
				}}
			/>
		</div>
	)
}

/**
 * Reads the active doc id straight off the matched child route — works
 * with TanStack Router's nested matching without an extra param hook.
 */
function useActiveDocId(): string | undefined {
	const matches = useChildMatches()
	for (const m of matches) {
		if (
			typeof m.params === "object" &&
			m.params !== null &&
			"id" in m.params &&
			typeof m.params.id === "string"
		) {
			return m.params.id
		}
	}
	return undefined
}
