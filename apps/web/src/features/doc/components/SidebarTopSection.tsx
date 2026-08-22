import { Button } from "@hoardodile/ui/components/button"
import { CountBadge } from "@hoardodile/ui/components/count-badge"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { Separator } from "@hoardodile/ui/components/separator"
import { Add } from "@hoardodile/ui/icons/actions"
import {
	Book,
	DocumentAdd,
	DoubleAltArrowDown,
	Filter,
	FolderPathConnect,
	Reorder,
	Settings,
	TrashBinMinimalistic,
	UndoLeftRound,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { SearchField } from "@/components/common/SearchField"
import { useSidebarMode } from "@/components/layout/sidebarMode"
import { createDocumentNodeMutation, invalidateDocuments } from "@/features/doc"
import { useDocTheme } from "@/features/doc/hooks/useDocPrefs"
import { useToastMutation } from "@/hooks/useToastMutation"

export type SidebarTopSectionProps = {
	readonly count: number
	readonly isLoading?: boolean
	readonly searchValue: string
	readonly onSearchChange: (next: string) => void
	/** Active character/resource filter (URL-backed) — the filter button
	    wears a count badge while either is set. */
	readonly charIds: readonly string[]
	readonly resIds: readonly string[]
	readonly onOpenFilter: () => void
	readonly trashMode: boolean
	readonly onToggleTrash: () => void
	readonly editMode: boolean
	readonly onEditModeChange: (next: boolean) => void
	readonly readingView: boolean
	readonly onToggleReadingView: () => void
	readonly readingViewDisabled?: boolean
	readonly onOpenAppearanceSettings: () => void
	readonly allExpanded?: boolean
	readonly onToggleExpandAll?: () => void
	readonly hasExpandableNodes?: boolean
}

type CreateKind = "document" | "folder"

/**
 * Header of the documents tree module: a filled search
 * field, then a six-icon toolbar row (create dropdown — creates
 * immediately with the default title, like the in-tree create —
 * expand/collapse, reorder edit mode, reading view, trash, appearance),
 * then the DOCUMENTS section label with the document count on the right.
 * In trash mode only the active trash and the appearance buttons remain.
 */
export function SidebarTopSection(props: SidebarTopSectionProps) {
	const { t } = useTranslation()
	const { themeClass } = useDocTheme()
	const navigate = useNavigate()
	const sidebarMode = useSidebarMode()

	const createMut = useToastMutation({
		...createDocumentNodeMutation(),
		invalidate: async (qc, created) => {
			await invalidateDocuments(qc)
			if (created.kind === "document") {
				await navigate({ to: "/documents/$id", params: { id: created.id } })
			}
		},
		errorToastKey: "documents.toast.createFailed",
	})

	function createDirectly(kind: CreateKind) {
		createMut.mutate({
			kind,
			title:
				kind === "folder"
					? t("documents.defaultNewFolderTitle")
					: t("documents.defaultNewTitle"),
		})
	}

	return (
		<div className="flex shrink-0 flex-col">
			{!props.trashMode && (
				<SearchField
					value={props.searchValue}
					onCommit={props.onSearchChange}
					placeholder={t("documents.searchPlaceholder")}
					testId="documents-search-input"
					actions={
						<DocFilterButton
							count={props.charIds.length + props.resIds.length}
							onOpenFilter={props.onOpenFilter}
						/>
					}
				/>
			)}
			{/* Module escape hatch — same spot under search as the shell's
			    "Back to documents menu" row in the main-menu view, same 2px
			    seam (DESIGN — DocTreeSidebar): mt-2 above, pb-2 below. The
			    two rows mirror each other across the two sidebar views. */}
			<div className="mt-2">
				<button
					type="button"
					onClick={sidebarMode?.showMainMenu}
					data-testid="sidebar-show-main-menu"
					className="flex h-nav w-full items-center gap-3 rounded-lg px-3 text-ui font-medium text-secondary-foreground hover:bg-muted"
				>
					<UndoLeftRound className="size-4 shrink-0" strokeWidth={1.6} />
					<span className="truncate">{t("appShell.backToMainMenu")}</span>
				</button>
				<Separator size="seam" className="mt-2" />
			</div>
			<div className="mt-1 flex items-center gap-1">
				{!props.trashMode && (
					<>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										variant="ghost"
										size="icon"
										disabled={createMut.isPending}
										title={t("documents.create")}
										aria-label={t("documents.create")}
										data-testid="documents-root-add"
										className={toolButtonClassName()}
									>
										<Add className="size-4" />
									</Button>
								}
							/>
							<DropdownMenuContent
								align="start"
								className={cn("doc", themeClass)}
							>
								<DropdownMenuItem onClick={() => createDirectly("document")}>
									<DocumentAdd className="mr-2 size-4" strokeWidth={1.6} />
									{t("documents.new")}
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => createDirectly("folder")}>
									<FolderPathConnect
										className="mr-2 size-4"
										strokeWidth={1.6}
									/>
									{t("documents.newFolder")}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<Button
							variant="ghost"
							size="icon"
							onClick={props.onToggleExpandAll}
							disabled={!props.hasExpandableNodes}
							title={
								props.allExpanded
									? t("documents.collapseAll")
									: t("documents.expandAll")
							}
							className={toolButtonClassName()}
							data-testid="documents-expand-toggle"
						>
							<DoubleAltArrowDown className="size-4" strokeWidth={1.6} />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => props.onEditModeChange(!props.editMode)}
							aria-pressed={props.editMode}
							title={t("documents.editMode.toggle")}
							data-testid="documents-edit-mode-toggle"
							className={toolButtonClassName(props.editMode)}
						>
							<Reorder className="size-4" strokeWidth={1.6} />
						</Button>
					</>
				)}
				<div className="flex-1" />
				{!props.trashMode && (
					<Button
						variant="ghost"
						size="icon"
						onClick={props.onToggleReadingView}
						disabled={props.readingViewDisabled}
						aria-pressed={props.readingView}
						title={
							props.readingView
								? t("documents.reading.exit")
								: t("documents.reading.enter")
						}
						data-testid="documents-reading-view-toggle"
						className={toolButtonClassName(props.readingView)}
					>
						<Book className="size-4" strokeWidth={1.6} />
					</Button>
				)}
				<Button
					variant="ghost"
					size="icon"
					onClick={props.onToggleTrash}
					aria-pressed={props.trashMode}
					title={t("documents.trash.open")}
					data-testid="documents-open-trash"
					className={toolButtonClassName(props.trashMode)}
				>
					<TrashBinMinimalistic className="size-4" strokeWidth={1.6} />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					onClick={props.onOpenAppearanceSettings}
					title={t("documents.appearanceSettings.title")}
					data-testid="documents-appearance-settings"
					className={toolButtonClassName()}
				>
					<Settings className="size-4" strokeWidth={1.6} />
				</Button>
			</div>
			{!props.trashMode && (
				<div className="mt-2 mb-0.5 flex items-center justify-between pl-2.5 pr-1.5">
					<span className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
						{t("documents.title")}
					</span>
					<span className="text-xs text-muted-foreground">
						{props.isLoading ? t("documents.loading") : props.count}
					</span>
				</div>
			)}
		</div>
	)
}

/**
 * Trailing in-field filter toggle — same size-6 anatomy as
 * ImageSearchButton on the resources search field.
 */
function DocFilterButton(props: {
	readonly count: number
	readonly onOpenFilter: () => void
}) {
	const { t } = useTranslation()
	const active = props.count > 0
	return (
		<button
			type="button"
			onClick={props.onOpenFilter}
			aria-pressed={active}
			title={t("documents.filter.title")}
			aria-label={t("documents.filter.title")}
			data-testid="documents-filter-toggle"
			className={cn(
				"relative flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground",
				active && "text-foreground",
			)}
		>
			<Filter className="size-4" strokeWidth={1.6} />
			{active ? (
				<CountBadge count={props.count} className="absolute -top-1 -right-1" />
			) : null}
		</button>
	)
}

/**
 * Toolbar icon buttons are 32px borderless squares; the
 * active toggle gets a fill, never an accent.
 */
function toolButtonClassName(active = false) {
	return cn(
		"size-8 rounded-lg text-secondary-foreground hover:bg-muted",
		active && "bg-muted text-foreground",
	)
}
