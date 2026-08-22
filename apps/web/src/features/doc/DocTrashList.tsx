import type { DocNode } from "@hoardodile/schemas"
import { MAX_PAGE_SIZE } from "@hoardodile/schemas"
import { Button } from "@hoardodile/ui/components/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { Spinner } from "@hoardodile/ui/components/spinner"
import { More } from "@hoardodile/ui/icons/actions"
import {
	FileText,
	Folder,
	TrashBinMinimalistic,
	UndoRightRound,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ConfirmByTypingDialog } from "@/components/common/ConfirmByTypingDialog"
import {
	docSearchQueryOptions,
	hardDeleteDocumentMutation,
	invalidateDocuments,
	restoreDocumentMutation,
} from "@/features/doc"
import { useDocTheme } from "@/features/doc/hooks/useDocPrefs"
import { useToastMutation } from "@/hooks/useToastMutation"

export type DocTrashListProps = {
	readonly activeId: string | undefined
	readonly onSelect?: () => void
}

/**
 * Flat recycle-bin list embedded in the sidebar (replaces DocTree when
 * trash mode is active). Each trashed node renders as a single row with
 * an icon, title, and a "more actions" dropdown containing restore and
 * permanent-delete. Styling mirrors DocSearchResults / DocTree rows.
 */
export function DocTrashList(props: DocTrashListProps) {
	const { t } = useTranslation()
	const trashQuery = useQuery(
		docSearchQueryOptions({ trashed: true, size: MAX_PAGE_SIZE }),
	)
	const rows = trashQuery.data?.rows ?? []

	return (
		<div className="flex flex-col gap-2">
			{trashQuery.isLoading ? (
				<div className="space-y-2 px-3 py-3">
					<p className="doc-label">{t("common.loading")}</p>
					<div className="h-8 w-full animate-pulse rounded-lg bg-muted" />
					<div className="h-8 w-5/6 animate-pulse rounded-lg bg-muted" />
					<div className="h-8 w-2/3 animate-pulse rounded-lg bg-muted" />
				</div>
			) : rows.length === 0 ? (
				<div className="px-3 py-3 text-xs text-muted-foreground">
					{t("documents.trash.empty")}
				</div>
			) : (
				<ul className="flex flex-col py-0.5" data-testid="documents-trash-list">
					{rows.map((row) => (
						<TrashRow
							key={row.id}
							node={row}
							isActive={props.activeId === row.id}
							onSelect={props.onSelect}
						/>
					))}
				</ul>
			)}
		</div>
	)
}

type TrashRowProps = {
	readonly node: DocNode
	readonly isActive: boolean
	readonly onSelect?: () => void
}

function TrashRow(props: TrashRowProps) {
	const { node, isActive } = props
	const { t } = useTranslation()
	const { themeClass } = useDocTheme()
	const [hardDeleteOpen, setHardDeleteOpen] = useState(false)
	const [typed, setTyped] = useState("")
	const isFolder = node.kind === "folder"
	const Icon = isFolder ? Folder : FileText

	const restoreMut = useToastMutation({
		...restoreDocumentMutation(),
		invalidate: (qc) => invalidateDocuments(qc, node.id),
		successToastKey: "documents.toast.restored",
		errorToastKey: "documents.toast.restoreFailed",
	})

	const hardMut = useToastMutation({
		...hardDeleteDocumentMutation(),
		invalidate: (qc) => invalidateDocuments(qc, node.id),
		successToastKey: "documents.toast.deletedForever",
		errorToastKey: "documents.toast.deleteFailed",
		onSuccess: () => {
			setHardDeleteOpen(false)
			setTyped("")
		},
	})

	function handleHardDeleteOpenChange(open: boolean) {
		if (open) return
		setHardDeleteOpen(false)
		setTyped("")
	}

	const inner = (
		<div className="h-full flex items-center gap-1.5 truncate">
			<Icon
				className="size-4 shrink-0 text-secondary-foreground"
				strokeWidth={1.6}
			/>
			<span className="truncate text-[13px] font-medium leading-none">
				{node.title}
			</span>
		</div>
	)

	return (
		<li
			className={cn(
				"group relative flex h-8 items-center gap-1 rounded-lg transition-colors duration-150",
				isActive ? "bg-muted" : "hover:bg-muted",
			)}
			data-testid={`documents-trash-row-${node.id}`}
		>
			{isFolder ? (
				<div
					className={cn(
						"relative h-full flex-1 rounded-lg px-3",
						isActive ? "text-foreground" : "text-muted-foreground",
					)}
				>
					{inner}
				</div>
			) : (
				<Link
					to="/documents/$id"
					params={{ id: node.id }}
					onClick={() => props.onSelect?.()}
					className={cn(
						"relative flex h-full flex-1 items-center rounded-lg px-3 transition-colors duration-150",
						isActive ? "text-foreground" : "text-secondary-foreground",
					)}
					data-testid={`documents-trash-open-${node.id}`}
				>
					{inner}
				</Link>
			)}

			<div
				className={cn(
					"flex shrink-0 items-center transition-opacity",
					"opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100",
				)}
			>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="ghost"
								size="icon"
								className="size-5 rounded-full text-muted-foreground/50 transition-colors hover:bg-transparent hover:text-foreground"
								aria-label={t("documents.moreActions")}
								onClick={(e) => e.stopPropagation()}
								data-testid={`documents-trash-more-${node.id}`}
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
							onClick={() => restoreMut.mutate(node.id)}
							data-testid={`documents-trash-restore-${node.id}`}
						>
							<UndoRightRound className="mr-2 size-4" />
							{t("documents.trash.restore")}
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => setHardDeleteOpen(true)}
							className="text-destructive focus:text-destructive"
							data-testid={`documents-trash-hard-delete-${node.id}`}
						>
							<TrashBinMinimalistic className="mr-2 size-4" />
							{t("documents.trash.hardDelete")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{restoreMut.isPending && (
				<Spinner className="absolute right-1 size-3.5 animate-spin text-muted-foreground" />
			)}

			<ConfirmByTypingDialog
				open={hardDeleteOpen}
				onOpenChange={handleHardDeleteOpenChange}
				title={t("documents.trash.hardDeleteTitle")}
				description={t("documents.trash.hardDeleteDescription")}
				targetName={node.title}
				expectedInput={node.title}
				typed={typed}
				onTypedChange={setTyped}
				pending={hardMut.isPending}
				confirmLabel={t("documents.trash.hardDeleteConfirm")}
				pendingLabel={t("documents.trash.hardDeleting")}
				onConfirm={() => hardMut.mutate(node.id)}
				inputTestId={`documents-trash-hard-delete-input-${node.id}`}
				confirmTestId={`documents-trash-hard-delete-confirm-${node.id}`}
			/>
		</li>
	)
}
