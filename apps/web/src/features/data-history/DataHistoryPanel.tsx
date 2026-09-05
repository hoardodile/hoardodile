import { Button } from "@hoardodile/ui/components/button"
import { ConfirmByTypingDialog } from "@hoardodile/ui/components/confirm-by-typing-dialog"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { Icon } from "@hoardodile/ui/components/icon"
import { QueryStateView } from "@hoardodile/ui/components/query-state-view"
import { Archive, Server } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { Fragment, useState } from "react"
import { useTranslation } from "react-i18next"
import { useConfirmDialog } from "@/components/common/useConfirmDialog"
import { useDateFormatter } from "@/features/settings/datePrefs"
import { SettingsSheet } from "@/features/settings/SettingsSheet"
import { useSaveMutation } from "@/hooks/useSaveMutation"
import { useToastMutation } from "@/hooks/useToastMutation"
import { hardResetAndReload } from "@/lib/client-reset"
import { trpcMutation } from "@/trpc/factory"
import {
	autoStatusQueryOptions,
	type BackupEvent,
	createBackupMutation,
	dataHistoryListQueryOptions,
	deleteBackupMutation,
	invalidateDataHistory,
	restoreBackupMutation,
	switchVersionMutation,
} from "./api"
import { CreateArchiveDialog } from "./CreateArchiveDialog"
import { DataHistoryDetail } from "./DataHistoryDetail"
import { DataHistoryTimeline } from "./DataHistoryTimeline"

/**
 * Unified "Data History" panel that replaces the former BackupsPanel and
 * VersionsPanel. Presents backups and archives on a single timeline, lets
 * the user add notes, and surfaces the consequence of every destructive
 * action in plain language.
 */
export function DataHistoryPanel({
	legacyReadOnly = true,
	embedded = false,
}: {
	legacyReadOnly?: boolean
	embedded?: boolean
} = {}) {
	const Sheet = embedded ? Fragment : SettingsSheet
	const { t } = useTranslation()
	const { formatDateTime } = useDateFormatter()
	const listQuery = useQuery(dataHistoryListQueryOptions())
	const autoStatusQuery = useQuery(autoStatusQueryOptions())
	const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
	const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)

	const restoreConfirm = useConfirmDialog<{
		readonly fileName: string
		readonly confirmName: string
	}>()
	const deleteConfirm = useConfirmDialog<{
		readonly fileName: string
		readonly confirmName: string
	}>()
	const switchConfirm = useConfirmDialog<number>()

	const createBackupMut = useSaveMutation({
		mutationOptions: createBackupMutation(),
		invalidate: invalidateDataHistory,
		successMessageKey: "dataHistory.toast.backupCreated",
		errorMessageKey: "dataHistory.toast.backupFailed",
	})

	const createVersionMut = useToastMutation({
		...trpcMutation("protection", "archive"),
		errorToastKey: "dataHistory.toast.archiveFailed",
		onSuccess: () => {
			setArchiveDialogOpen(false)
		},
	})

	const restoreMut = useToastMutation({
		...restoreBackupMutation(),
		errorToastKey: "dataHistory.toast.restoreFailed",
		onSuccess: () => {
			restoreConfirm.close()
			void hardResetAndReload(t("dataHistory.reloading"))
		},
	})

	const deleteMut = useSaveMutation({
		mutationOptions: deleteBackupMutation(),
		invalidate: invalidateDataHistory,
		onSaved: () => {
			deleteConfirm.close()
			if (selectedId?.startsWith("backup-")) {
				setSelectedId(undefined)
			}
		},
		successMessageKey: "dataHistory.toast.backupDeleted",
		errorMessageKey: "dataHistory.toast.deleteFailed",
	})

	const switchMut = useToastMutation({
		...switchVersionMutation(),
		errorToastKey: "dataHistory.toast.switchFailed",
		onSuccess: () => {
			switchConfirm.close()
			void hardResetAndReload(t("dataHistory.reloading"))
		},
	})

	function handleCreateBackup() {
		createBackupMut.mutate({})
	}

	function handleCreateArchive(input: { readonly note?: string }) {
		createVersionMut.mutate(input)
	}

	function resolveBackupConfirmName(backup: BackupEvent): string {
		if (backup.auto) return t("dataHistory.confirm.autoPhrase")
		const trimmed = backup.name?.trim()
		return trimmed && trimmed.length > 0
			? trimmed
			: formatDateTime(backup.createdAt)
	}

	function findBackupByFileName(fileName: string): BackupEvent | undefined {
		const data = listQuery.data
		if (data === undefined) return undefined
		for (const group of data.groups) {
			const backup = group.backups.find((b) => b.fileName === fileName)
			if (backup !== undefined) return backup
		}
		return undefined
	}

	function handleRestore(fileName: string) {
		const backup = findBackupByFileName(fileName)
		if (backup === undefined) return
		restoreConfirm.open({
			fileName,
			confirmName: resolveBackupConfirmName(backup),
		})
	}

	function handleDeleteBackup(fileName: string) {
		const backup = findBackupByFileName(fileName)
		if (backup === undefined) return
		deleteConfirm.open({
			fileName,
			confirmName: resolveBackupConfirmName(backup),
		})
	}

	function handleSwitchVersion(version: number) {
		switchConfirm.open(version)
	}

	return (
		<div className="flex flex-col">
			{/* Toolbar row — the backup/archive actions and the writability
			    status pill live above the sheet (design SettingsBackupsPage:
			    the toolbar carries mb-3 and the auto line tucks in right
			    below the buttons with -mt-2). */}
			<div className="mb-3 flex flex-wrap items-center justify-between gap-4">
				<div className="flex flex-wrap items-center gap-2">
					{!legacyReadOnly && (
						<Button
							onClick={handleCreateBackup}
							disabled={createBackupMut.isPending || createVersionMut.isPending}
							data-testid="create-backup"
						>
							<Icon icon={Server} />
							{createBackupMut.isPending
								? t("dataHistory.action.backingUp")
								: t("dataHistory.action.backupNow")}
						</Button>
					)}
					<Button
						variant="secondary"
						onClick={() => setArchiveDialogOpen(true)}
						disabled={createBackupMut.isPending || createVersionMut.isPending}
						data-testid="create-archive"
					>
						<Icon icon={Archive} />
						{t("dataHistory.action.archiveNow")}
					</Button>
				</div>
				{listQuery.data !== undefined ? (
					<StatusPill
						currentVersion={listQuery.data.currentVersion}
						activeVersion={listQuery.data.activeVersion}
						currentArchiveName={
							listQuery.data.groups.find((g) => g.archive.current)?.archive.name
						}
					/>
				) : null}
			</div>

			{!legacyReadOnly && (
				<AutoSnapshotStatusLine
					status={autoStatusQuery.data}
					formatDateTime={formatDateTime}
					className="-mt-2 mb-3"
				/>
			)}

			<Sheet>
				<QueryStateView
					result={listQuery}
					isEmpty={(data) => data.groups.length === 0}
					loading={
						<div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
							{t("common.loading")}
						</div>
					}
					empty={
						<div
							className="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground"
							data-testid="data-history-empty"
						>
							<p className="font-medium">{t("dataHistory.empty.title")}</p>
							<p className="mt-1 text-xs">
								{t("dataHistory.empty.description")}
							</p>
						</div>
					}
				>
					{(data) => (
						<div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_var(--spacing-sidebar)]">
							<div className="min-w-0">
								<DataHistoryTimeline
									data={data}
									selectedId={selectedId}
									onSelect={setSelectedId}
								/>
							</div>
							<div className="min-w-0">
								<DataHistoryDetail
									legacyReadOnly={legacyReadOnly}
									data={data}
									selectedId={selectedId}
									onRestore={handleRestore}
									onDeleteBackup={handleDeleteBackup}
									onSwitchVersion={handleSwitchVersion}
									isRestoring={restoreMut.isPending}
									isDeleting={deleteMut.isPending}
									isSwitching={switchMut.isPending}
								/>
							</div>
						</div>
					)}
				</QueryStateView>
			</Sheet>

			<CreateArchiveDialog
				open={archiveDialogOpen}
				onOpenChange={setArchiveDialogOpen}
				onConfirm={handleCreateArchive}
				pending={createVersionMut.isPending}
			/>

			{restoreConfirm.target !== undefined ? (
				<ConfirmByTypingDialog
					open={restoreConfirm.isOpen}
					onOpenChange={restoreConfirm.onOpenChange}
					title={t("dataHistory.confirm.restoreTitle")}
					description={t("dataHistory.confirm.restoreDescription")}
					targetName={restoreConfirm.target.confirmName}
					expectedInput={restoreConfirm.target.confirmName}
					confirmLabel={t("dataHistory.action.restore")}
					pendingLabel={t("common.working")}
					pending={restoreMut.isPending}
					typed={restoreConfirm.typed}
					onTypedChange={restoreConfirm.setTyped}
					onConfirm={() => {
						if (restoreConfirm.target === undefined) return
						restoreMut.mutate(restoreConfirm.target.fileName)
					}}
					inputTestId="restore-confirm-input"
					confirmTestId="restore-confirm-submit"
				/>
			) : null}

			{deleteConfirm.target !== undefined ? (
				<ConfirmByTypingDialog
					open={deleteConfirm.isOpen}
					onOpenChange={deleteConfirm.onOpenChange}
					title={t("dataHistory.confirm.deleteBackupTitle")}
					description={t("dataHistory.confirm.deleteBackupDescription")}
					targetName={deleteConfirm.target.confirmName}
					expectedInput={deleteConfirm.target.confirmName}
					confirmLabel={t("dataHistory.action.delete")}
					pendingLabel={t("common.working")}
					pending={deleteMut.isPending}
					typed={deleteConfirm.typed}
					onTypedChange={deleteConfirm.setTyped}
					onConfirm={() => {
						if (deleteConfirm.target === undefined) return
						deleteMut.mutate(deleteConfirm.target.fileName)
					}}
					inputTestId="delete-confirm-input"
					confirmTestId="delete-confirm-submit"
				/>
			) : null}

			{switchConfirm.target !== undefined ? (
				<ConfirmDialog
					open={switchConfirm.isOpen}
					onOpenChange={switchConfirm.onOpenChange}
					title={t("dataHistory.confirm.switchTitle")}
					description={t("dataHistory.confirm.switchDescription")}
					confirmLabel={t("dataHistory.action.switchToVersion")}
					pendingLabel={t("common.working")}
					isPending={switchMut.isPending}
					onConfirm={() => {
						if (switchConfirm.target === undefined) return
						switchMut.mutate(switchConfirm.target)
					}}
					confirmTestId="switch-confirm-submit"
				/>
			) : null}
		</div>
	)
}

type StatusPillProps = {
	readonly currentVersion: number
	readonly activeVersion: number
	readonly currentArchiveName?: string
}

type AutoSnapshotStatusLineProps = {
	readonly status:
		| {
				readonly enabled: boolean
				readonly keep: number
				readonly lastAt: number | null
		  }
		| undefined
	readonly formatDateTime: (ts: number) => string
	readonly className?: string
}

/**
 * One-line status of the automatic daily snapshot scheduler: whether it
 * is enabled, the retention window, and when the newest snapshot was
 * taken. Hidden while the status query is still loading.
 */
function AutoSnapshotStatusLine(props: AutoSnapshotStatusLineProps) {
	const { status, formatDateTime, className } = props
	const { t } = useTranslation()
	if (status === undefined) return null
	if (!status.enabled) {
		return (
			<p
				className={cn("text-tiny text-muted-foreground", className)}
				data-testid="auto-status"
			>
				{t("dataHistory.autoSnapshot.disabled")}
			</p>
		)
	}
	return (
		<p
			className={cn("text-tiny text-muted-foreground", className)}
			data-testid="auto-status"
		>
			{t("dataHistory.autoSnapshot.enabled", {
				keep: status.keep,
			})}
			{status.lastAt !== null ? (
				<>
					{" · "}
					{t("dataHistory.autoSnapshot.last", {
						time: formatDateTime(status.lastAt),
					})}
				</>
			) : null}
		</p>
	)
}

function StatusPill(props: StatusPillProps) {
	const { currentVersion, activeVersion, currentArchiveName } = props
	const { t } = useTranslation()
	const isViewingArchive = activeVersion !== currentVersion

	const baseText = isViewingArchive
		? t("dataHistory.status.viewingArchive", { version: activeVersion })
		: t("dataHistory.status.currentWritable", { version: currentVersion })

	return (
		<span
			className="inline-flex shrink-0 items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-secondary-foreground"
			data-testid="data-history-status"
		>
			<span
				className={cn(
					"size-1.5 rounded-full",
					isViewingArchive ? "bg-destructive" : "bg-emerald-500",
				)}
			/>
			<span className="flex min-w-0 items-center gap-1">
				<span className="truncate">{baseText}</span>
				{currentArchiveName !== undefined && currentArchiveName.length > 0 ? (
					<span className="truncate text-muted-foreground">
						· {currentArchiveName}
					</span>
				) : null}
			</span>
		</span>
	)
}
