import { DndContext } from "@dnd-kit/core"
import type {
	DocCreateInput,
	DocNode,
	DocRenameInput,
} from "@hoardodile/schemas"
import { MAX_NAME_LENGTH } from "@hoardodile/schemas"
import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { Input } from "@hoardodile/ui/components/input"
import { More } from "@hoardodile/ui/icons/actions"
import {
	AltArrowDown,
	AltArrowRight,
	DocumentAdd,
	DocumentText,
	Folder,
	FolderPathConnect,
	Pen,
	TrashBinMinimalistic,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import type { UseMutationResult } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import {
	createContext,
	Fragment,
	memo,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { useTranslation } from "react-i18next"
import {
	createDocumentNodeMutation,
	invalidateDocuments,
	renameDocumentNodeMutation,
	softDeleteDocumentMutation,
} from "@/features/doc"
import { useDocTheme } from "@/features/doc/hooks/useDocPrefs"
import { useToastMutation } from "@/hooks/useToastMutation"
import {
	type DragAPI,
	useDocumentDragDrop,
	useTreeRowDnd,
} from "./useDocDragDrop"
import {
	buildDocumentTree,
	type DocTreeNode as TreeNode,
} from "./utils/buildDocTree"

const DragContext = createContext<DragAPI | undefined>(undefined)

type TreeActions = {
	readonly create: UseMutationResult<DocNode, Error, DocCreateInput, unknown>
	readonly rename: UseMutationResult<DocNode, Error, DocRenameInput, unknown>
	readonly softDelete: UseMutationResult<DocNode, Error, string, unknown>
}

const TreeActionsContext = createContext<TreeActions | undefined>(undefined)

function useTreeActions(): TreeActions {
	const ctx = useContext(TreeActionsContext)
	if (ctx === undefined) {
		throw new Error("TreeBranch must be rendered inside a TreeActionsContext")
	}
	return ctx
}

export type DocTreeProps = {
	readonly nodes: readonly DocNode[]
	readonly activeId: string | undefined
	/**
	 * When `true`, enables the drag-and-drop reorder UI on desktop
	 * pointers. The documents layout exposes this as an explicit
	 * "edit mode" toggle so casual reading does not accidentally
	 * rearrange the tree.
	 */
	readonly editMode?: boolean
	/**
	 * Optional click handler fired whenever the user navigates to a
	 * document. The unified workspace layout uses this to dismiss the
	 * mobile drawer once a document is opened.
	 */
	readonly onSelect?: () => void
	/**
	 * When `true`, renders a loading skeleton instead of the empty
	 * state or the tree. The parent layout drives this from the
	 * workspace query's pending state.
	 */
	readonly isLoading?: boolean
	/**
	 * The set of currently expanded folder ids. The parent layout owns
	 * the expansion preference so the action-bar toggle can stay in sync.
	 */
	readonly expandedIds: ReadonlySet<string>
	/**
	 * Toggle expansion for a single folder.
	 */
	readonly onToggleExpanded: (id: string) => void
	/**
	 * Expand a batch of folder ids without collapsing others. Used by
	 * the auto-expand-ancestors effect.
	 */
	readonly onExpandIds: (ids: Iterable<string>) => void
}

function findAncestors(
	nodes: readonly TreeNode[],
	targetId: string,
	path: string[],
): string[] | null {
	for (const n of nodes) {
		if (n.node.id === targetId) return path
		const found = findAncestors(n.children, targetId, [...path, n.node.id])
		if (found) return found
	}
	return null
}

export const DocTree = memo(function DocTree(props: DocTreeProps) {
	const { t } = useTranslation()
	const { themeClass } = useDocTheme()
	const tree = useMemo(() => buildDocumentTree(props.nodes), [props.nodes])
	const dragAPI = useDocumentDragDrop(props.nodes, props.editMode === true)

	const createMut = useToastMutation({
		...createDocumentNodeMutation(),
		invalidate: (qc) => invalidateDocuments(qc),
		errorToastKey: "documents.toast.createFailed",
	})
	const renameMut = useToastMutation({
		...renameDocumentNodeMutation(),
		invalidate: (qc) => invalidateDocuments(qc),
		errorToastKey: "documents.toast.renameFailed",
	})
	const softDeleteMut = useToastMutation({
		...softDeleteDocumentMutation(),
		invalidate: (qc) => invalidateDocuments(qc),
		successToastKey: "documents.toast.movedToTrash",
		errorToastKey: "documents.toast.deleteFailed",
	})

	const { expandedIds, onToggleExpanded, onExpandIds } = props

	// Auto-expand ancestors of the initially opened document only once after
	// mount/refresh. After that the user must own the collapsed/expanded state.
	const hasAutoExpandedRef = useRef(false)
	useEffect(() => {
		if (!props.activeId) return
		if (hasAutoExpandedRef.current) return
		const ancestors = findAncestors(tree, props.activeId, [])
		if (!ancestors) return
		onExpandIds(ancestors)
		hasAutoExpandedRef.current = true
	}, [props.activeId, tree, onExpandIds])

	if (props.isLoading) {
		return (
			<div className="space-y-2 px-3 py-3" data-testid="documents-loading">
				<p className="doc-label">{t("documents.loading")}</p>
				<div className="h-8 w-full animate-pulse rounded-lg bg-muted" />
				<div className="h-8 w-5/6 animate-pulse rounded-lg bg-muted" />
				<div className="h-8 w-2/3 animate-pulse rounded-lg bg-muted" />
			</div>
		)
	}

	if (tree.length === 0) {
		return (
			<div
				className="doc-reveal mx-3 flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-14 text-center"
				data-testid="documents-empty"
			>
				<p className="text-sm text-muted-foreground">
					{t("documents.listEmpty")}
				</p>
			</div>
		)
	}

	return (
		<TreeActionsContext.Provider
			value={{
				create: createMut,
				rename: renameMut,
				softDelete: softDeleteMut,
			}}
		>
			<DragContext.Provider value={dragAPI}>
				<DndContext {...dragAPI.contextProps}>
					<ul className="flex flex-col gap-1" data-testid="documents-list">
						{tree.map((branch) => (
							<Fragment key={branch.node.id}>
								<TreeBranch
									branch={branch}
									depth={0}
									activeId={props.activeId}
									onSelect={props.onSelect}
									expandedIds={expandedIds}
									onToggleExpanded={onToggleExpanded}
									themeClass={themeClass}
								/>
							</Fragment>
						))}
					</ul>
				</DndContext>
			</DragContext.Provider>
		</TreeActionsContext.Provider>
	)
})

type TreeBranchProps = {
	readonly branch: TreeNode
	readonly depth: number
	readonly activeId: string | undefined
	readonly onSelect: (() => void) | undefined
	readonly expandedIds: ReadonlySet<string>
	readonly onToggleExpanded: (id: string) => void
	readonly themeClass: string | undefined
}

const TreeBranch = memo(function TreeBranch(props: TreeBranchProps) {
	const {
		branch,
		depth,
		activeId,
		onSelect,
		expandedIds,
		onToggleExpanded,
		themeClass,
	} = props
	const expanded = expandedIds.has(branch.node.id)
	const { t } = useTranslation()
	const navigate = useNavigate()
	const drag = useContext(DragContext)
	const actions = useTreeActions()
	const isFolder = branch.node.kind === "folder"
	const hasChildren = branch.children.length > 0
	const rowDnd = useTreeRowDnd(branch.node.id, isFolder)
	const [renaming, setRenaming] = useState(false)
	const [renameTitle, setRenameTitle] = useState("")
	const [softDeleteOpen, setSoftDeleteOpen] = useState(false)
	const isActive = activeId === branch.node.id

	function createDirectly(kind: "folder" | "document") {
		const title =
			kind === "folder"
				? t("documents.defaultNewFolderTitle")
				: t("documents.defaultNewTitle")
		actions.create.mutate(
			{ kind, title, parentId: branch.node.id },
			{
				onSuccess: (created) => {
					if (created.kind === "document") {
						onSelect?.()
						navigate({ to: "/documents/$id", params: { id: created.id } })
					}
				},
			},
		)
	}

	function startRename() {
		setRenaming(true)
		setRenameTitle(branch.node.title)
	}

	function submitRename() {
		const title = renameTitle.trim()
		if (title.length === 0) return
		if (title === branch.node.title) {
			setRenaming(false)
			return
		}
		actions.rename.mutate(
			{ id: branch.node.id, title },
			{
				onSuccess: () => {
					setRenaming(false)
					setRenameTitle("")
				},
			},
		)
	}

	function renderIcon() {
		if (isFolder) {
			return <Folder className="size-4" strokeWidth={1.6} />
		}
		return <DocumentText className="size-4" strokeWidth={1.6} />
	}

	function handleRowClick() {
		if (renaming) return
		if (isFolder) {
			onToggleExpanded(branch.node.id)
			return
		}
		onSelect?.()
		navigate({ to: "/documents/$id", params: { id: branch.node.id } })
	}

	return (
		<li data-testid={`documents-row-${branch.node.id}`}>
			{/* Row-wide click is a pointer convenience; keyboard users reach the
			    same action through the title link / expand button inside. */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: inner control covers keyboard access. */}
			<div
				ref={drag?.enabled === true ? rowDnd.setNodeRef : undefined}
				{...(drag?.enabled === true ? rowDnd.attributes : {})}
				{...(drag?.enabled === true ? rowDnd.listeners : {})}
				onClick={handleRowClick}
				className={cn(
					"group relative flex h-nav cursor-pointer items-center gap-2 rounded-lg pr-1",
					isActive
						? "bg-muted font-medium text-foreground"
						: "text-secondary-foreground hover:bg-muted",
					drag !== undefined &&
						drag.draggedId === branch.node.id &&
						"opacity-50",
					drag !== undefined &&
						drag.hover?.id === branch.node.id &&
						drag.hover.mode === "into" &&
						"bg-primary/15 ring-1 ring-primary/40",
				)}
				style={{ paddingLeft: `${0.75 + depth * 1.5}rem` }}
			>
				{drag !== undefined &&
				drag.hover?.id === branch.node.id &&
				drag.hover.mode === "before" ? (
					<span
						className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded-full bg-primary"
						data-testid="documents-row-drop-indicator"
					/>
				) : undefined}
				{drag !== undefined &&
				drag.hover?.id === branch.node.id &&
				drag.hover.mode === "after" ? (
					<span
						className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary"
						data-testid="documents-row-drop-indicator"
					/>
				) : undefined}
				<button
					type="button"
					className={cn(
						"flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground",
						!hasChildren && "pointer-events-none opacity-0",
					)}
					onClick={(e) => {
						e.stopPropagation()
						onToggleExpanded(branch.node.id)
					}}
					aria-label={expanded ? t("common.collapse") : t("common.expand")}
				>
					{expanded ? (
						<AltArrowDown className="size-4" strokeWidth={1.6} />
					) : (
						<AltArrowRight className="size-4" strokeWidth={1.6} />
					)}
				</button>
				<span className="flex size-4 shrink-0 items-center justify-center text-secondary-foreground">
					{renderIcon()}
				</span>
				{renaming ? (
					<Input
						autoFocus
						maxLength={MAX_NAME_LENGTH}
						value={renameTitle}
						onChange={(e) => setRenameTitle(e.target.value)}
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							if (e.key === "Enter") submitRename()
							if (e.key === "Escape") {
								setRenaming(false)
								setRenameTitle("")
							}
						}}
						size="sm"
						className="flex-1"
						data-testid={`documents-rename-input-${branch.node.id}`}
					/>
				) : isFolder ? (
					<button
						type="button"
						className="flex-1 truncate text-left text-[13px] leading-none"
						onClick={(e) => {
							e.stopPropagation()
							onToggleExpanded(branch.node.id)
						}}
					>
						{branch.node.title}
					</button>
				) : (
					<Link
						to="/documents/$id"
						params={{ id: branch.node.id }}
						className="flex-1 truncate text-left text-[13px] leading-none"
						onClick={(e) => {
							e.stopPropagation()
							onSelect?.()
						}}
						data-testid={`documents-open-${branch.node.id}`}
					>
						{branch.node.title}
					</Link>
				)}
				<div
					className={cn(
						"flex shrink-0 items-center",
						// Always visible on touch / narrow screens (Notion style),
						// collapses to a hover-revealed control on md+ pointers.
						"opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100",
					)}
				>
					{renaming ? (
						<>
							<Button
								size="sm"
								className="h-6 px-2"
								onClick={submitRename}
								disabled={
									actions.rename.isPending || renameTitle.trim().length === 0
								}
								data-testid={`documents-rename-confirm-${branch.node.id}`}
							>
								{t("common.confirm")}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								className="h-6 px-2"
								onClick={() => {
									setRenaming(false)
									setRenameTitle("")
								}}
								data-testid={`documents-rename-cancel-${branch.node.id}`}
							>
								{t("common.cancel")}
							</Button>
						</>
					) : (
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										variant="ghost"
										size="icon"
										className="size-5 rounded-full text-muted-foreground/50 hover:bg-transparent hover:text-foreground"
										aria-label={t("documents.moreActions")}
										onClick={(e) => e.stopPropagation()}
										data-testid={`documents-more-${branch.node.id}`}
									>
										<More className="size-4" strokeWidth={1.6} />
									</Button>
								}
							/>
							<DropdownMenuContent
								align="end"
								className={cn("doc w-44", themeClass)}
							>
								<DropdownMenuItem
									onClick={() => createDirectly("document")}
									data-testid={`documents-create-doc-${branch.node.id}`}
								>
									<DocumentAdd className="mr-2 size-4" />
									{t("documents.new")}
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() => createDirectly("folder")}
									data-testid={`documents-create-folder-${branch.node.id}`}
								>
									<FolderPathConnect className="mr-2 size-4" />
									{t("documents.newFolder")}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									onClick={() => startRename()}
									data-testid={`documents-rename-${branch.node.id}`}
								>
									<Pen className="mr-2 size-4" />
									{t("common.rename")}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									onClick={() => setSoftDeleteOpen(true)}
									className="text-destructive focus:text-destructive"
									data-testid={`documents-delete-${branch.node.id}`}
								>
									<TrashBinMinimalistic className="mr-2 size-4" />
									{t("common.delete")}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			</div>

			{hasChildren && expanded && (
				// Collapsed branches are unmounted to keep large trees
				// responsive; the open/close animation is traded for
				// render isolation.
				<div className="grid grid-rows-[1fr]">
					<ul className="flex min-h-0 flex-col gap-1 overflow-hidden">
						{branch.children.map((child) => (
							<TreeBranch
								key={child.node.id}
								branch={child}
								depth={depth + 1}
								activeId={activeId}
								onSelect={onSelect}
								expandedIds={expandedIds}
								onToggleExpanded={onToggleExpanded}
								themeClass={themeClass}
							/>
						))}
					</ul>
				</div>
			)}

			<ConfirmDialog
				open={softDeleteOpen}
				onOpenChange={setSoftDeleteOpen}
				contentClassName={cn("doc", themeClass)}
				title={t("documents.softDeleteDialog.title")}
				description={
					isFolder && hasChildren ? (
						<>
							{t("documents.softDeleteDialog.description")}
							<br />
							{t("documents.softDeleteDialog.folderWarning")}
						</>
					) : (
						t("documents.softDeleteDialog.description")
					)
				}
				body={
					<div
						className="break-all py-2 text-base font-medium"
						data-testid={`documents-soft-delete-name-${branch.node.id}`}
					>
						{branch.node.title}
					</div>
				}
				isPending={actions.softDelete.isPending}
				destructive={true}
				onConfirm={() =>
					actions.softDelete.mutate(branch.node.id, {
						onSuccess: () => setSoftDeleteOpen(false),
					})
				}
				confirmLabel={t("documents.softDeleteDialog.confirm")}
				confirmTestId={`documents-soft-delete-confirm-${branch.node.id}`}
			/>
		</li>
	)
})
