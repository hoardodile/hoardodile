import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { IconTile } from "@hoardodile/ui/components/icon-tile"
import { toast } from "@hoardodile/ui/components/toast"
import {
	Download,
	History,
	Server,
	TrashBinMinimalistic,
	UndoRightRound,
} from "@hoardodile/ui/icons/registry"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useDateFormatter } from "@/features/settings/datePrefs"
import { useToastMutation } from "@/hooks/useToastMutation"
import { formatBytes } from "@/lib/formatBytes"
import { apiPaths } from "@/lib/paths"
import type { BackupEvent, DataHistoryList } from "./api"
import {
	dataHistoryKeys,
	updateBackupMetaMutation,
	updateVersionMetaMutation,
} from "./api"
import { HistoryNoteEditor } from "./HistoryNoteEditor"
import { InlineNameEditor } from "./InlineNameEditor"

export type DataHistoryDetailProps = {
	readonly legacyReadOnly?: boolean
	readonly data: DataHistoryList
	readonly selectedId: string | undefined
	readonly onRestore: (fileName: string) => void
	readonly onDeleteBackup: (fileName: string) => void
	readonly onSwitchVersion: (version: number) => void
	readonly isRestoring: boolean
	readonly isDeleting: boolean
	readonly isSwitching: boolean
}

export function DataHistoryDetail(props: DataHistoryDetailProps) {
	const {
		data,
		selectedId,
		onRestore,
		onDeleteBackup,
		onSwitchVersion,
		isRestoring,
		isDeleting,
		isSwitching,
	} = props
	const { t } = useTranslation()

	const selected = findEventById(data, selectedId)

	if (selected === undefined) {
		return (
			<div
				className="flex h-full min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6 text-center"
				data-testid="data-history-empty-detail"
			>
				<p className="text-sm text-muted-foreground">
					{t("dataHistory.detail.selectPrompt")}
				</p>
			</div>
		)
	}

	return selected.kind === "archive" ? (
		<ArchiveDetail
			archive={selected}
			onSwitch={() => onSwitchVersion(selected.version)}
			isSwitching={isSwitching}
		/>
	) : (
		<BackupDetail
			legacyReadOnly={props.legacyReadOnly}
			backup={selected}
			currentVersion={data.currentVersion}
			onRestore={() => onRestore(selected.fileName)}
			onDelete={() => onDeleteBackup(selected.fileName)}
			isRestoring={isRestoring}
			isDeleting={isDeleting}
		/>
	)
}

function findEventById(
	data: DataHistoryList,
	id: string | undefined,
): BackupEvent | DataHistoryList["groups"][number]["archive"] | undefined {
	if (id === undefined) return undefined
	for (const group of data.groups) {
		if (group.archive.id === id) return group.archive
		const backup = group.backups.find((b) => b.id === id)
		if (backup !== undefined) return backup
	}
	return undefined
}

/** Detail meta line — muted label left, medium value right. */
function MetaRow({
	label,
	value,
}: {
	readonly label: string
	readonly value: string
}) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="text-xs text-muted-foreground">{label}</span>
			<span className="text-right text-xs font-medium text-foreground">
				{value}
			</span>
		</div>
	)
}

type ArchiveDetailProps = {
	readonly archive: DataHistoryList["groups"][number]["archive"]
	readonly onSwitch: () => void
	readonly isSwitching: boolean
}

function ArchiveDetail(props: ArchiveDetailProps) {
	const { archive, onSwitch, isSwitching } = props
	const { t } = useTranslation()
	const { formatDateTime } = useDateFormatter()
	const canEditMeta = archive.current

	const updateMeta = useToastMutation({
		...updateVersionMetaMutation(),
		invalidate: (qc) =>
			qc.invalidateQueries({ queryKey: dataHistoryKeys.list() }),
		successToastKey: "dataHistory.toast.metaSaved",
		errorToastKey: "dataHistory.toast.metaSaveFailed",
	})

	return (
		<div
			className="h-fit rounded-xl border border-border p-5"
			data-testid={`detail-${archive.id}`}
		>
			<div className="flex items-center gap-2.5">
				<IconTile icon={History} size={40} iconSize="lg" />
				<div className="min-w-0">
					<div className="truncate text-ui font-semibold text-foreground">
						{archive.name ??
							t("dataHistory.archive.title", { version: archive.version })}
					</div>
					<div className="text-tiny text-muted-foreground">
						{t("dataHistory.detail.archiveVersion", {
							version: archive.version,
						})}
					</div>
				</div>
			</div>

			<div className="mt-5 flex flex-col gap-2.5">
				<MetaRow
					label={t("dataHistory.detail.size")}
					value={formatBytes(archive.dbSize)}
				/>
				<MetaRow
					label={t("dataHistory.detail.versionNumber")}
					value={`v${archive.version}`}
				/>
				{archive.createdAt !== undefined ? (
					<MetaRow
						label={t("dataHistory.detail.createdAt")}
						value={formatDateTime(archive.createdAt)}
					/>
				) : null}
			</div>

			{canEditMeta ? (
				<div className="mt-4">
					<p className="mb-1.5 text-xs text-muted-foreground">
						{t("dataHistory.archive.nameLabel")}
					</p>
					<InlineNameEditor
						name={archive.name ?? ""}
						onSave={(name) =>
							updateMeta.mutate({ version: archive.version, name })
						}
						disabled={updateMeta.isPending}
						placeholder={t("dataHistory.archive.namePlaceholder")}
					/>
				</div>
			) : null}

			{canEditMeta ||
			(archive.note !== undefined && archive.note.length > 0) ? (
				<div className="mt-4">
					<p className="mb-1.5 text-xs text-muted-foreground">
						{t("dataHistory.detail.note")}
					</p>
					{canEditMeta ? (
						<HistoryNoteEditor
							note={archive.note}
							onSave={(note) =>
								updateMeta.mutate({ version: archive.version, note })
							}
							disabled={updateMeta.isPending}
						/>
					) : (
						<p className="text-sm">{archive.note}</p>
					)}
				</div>
			) : null}

			<div className="mt-5 flex flex-col gap-2">
				{!archive.active ? (
					<>
						<Button
							className="justify-center"
							onClick={onSwitch}
							disabled={isSwitching}
							data-testid={`switch-${archive.version}`}
						>
							<Icon icon={UndoRightRound} />
							{isSwitching
								? t("dataHistory.action.switching")
								: t("dataHistory.action.switchToVersion")}
						</Button>
						<p className="text-tiny leading-4 text-muted-foreground">
							{t("dataHistory.archive.switchHint")}
						</p>
					</>
				) : (
					<p className="text-tiny leading-4 text-muted-foreground">
						{t("dataHistory.archive.activeHint")}
					</p>
				)}
				<Button
					variant="secondary"
					className="justify-center"
					data-testid={`download-version-${archive.version}`}
					nativeButton={false}
					render={
						<a href={apiPaths.versions.dbDownload(archive.version)}>
							<Icon icon={Download} />
							{t("dataHistory.action.download")}
						</a>
					}
				/>
			</div>
		</div>
	)
}

type BackupDetailProps = {
	readonly legacyReadOnly?: boolean
	readonly backup: BackupEvent
	readonly currentVersion: number
	readonly onRestore: () => void
	readonly onDelete: () => void
	readonly isRestoring: boolean
	readonly isDeleting: boolean
}

function BackupDetail(props: BackupDetailProps) {
	const {
		backup,
		currentVersion,
		onRestore,
		onDelete,
		isRestoring,
		isDeleting,
	} = props
	const { t } = useTranslation()
	const { formatDateTime } = useDateFormatter()
	const queryClient = useQueryClient()

	const updateMeta = useMutation({
		...updateBackupMetaMutation(),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: dataHistoryKeys.list(),
			})
			toast.add({ title: t("dataHistory.toast.metaSaved"), type: "success" })
		},
		onError: () =>
			toast.add({
				title: t("dataHistory.toast.metaSaveFailed"),
				type: "error",
			}),
	})

	const isArchived =
		props.legacyReadOnly === true ||
		backup.activeVersionAtCreate !== currentVersion
	const canEditMeta = !backup.auto && !isArchived

	return (
		<div
			className="h-fit rounded-xl border border-border p-5"
			data-testid={`detail-${backup.id}`}
		>
			<div className="flex items-center gap-2.5">
				<IconTile icon={Server} size={40} iconSize="lg" />
				<div className="min-w-0">
					<div className="truncate text-ui font-semibold text-foreground">
						{backup.name ?? backup.fileName}
					</div>
					<div className="text-tiny text-muted-foreground">
						{t("dataHistory.detail.backupOnVersion", {
							version: backup.activeVersionAtCreate,
						})}
					</div>
				</div>
			</div>

			<div className="mt-5 flex flex-col gap-2.5">
				<MetaRow
					label={t("dataHistory.detail.createdAt")}
					value={formatDateTime(backup.createdAt)}
				/>
				<MetaRow
					label={t("dataHistory.detail.size")}
					value={formatBytes(backup.size)}
				/>
				{backup.counts !== undefined ? (
					<MetaRow
						label={t("dataHistory.detail.contents")}
						value={t("dataHistory.detail.contentsValue", {
							resources: backup.counts.resources,
							characters: backup.counts.characters,
							documents: backup.counts.documents,
						})}
					/>
				) : null}
			</div>

			{canEditMeta ? (
				<>
					<div className="mt-4">
						<p className="mb-1.5 text-xs text-muted-foreground">
							{t("dataHistory.backup.nameLabel")}
						</p>
						<InlineNameEditor
							name={backup.name ?? ""}
							onSave={(name) =>
								updateMeta.mutate({ fileName: backup.fileName, name })
							}
							disabled={updateMeta.isPending}
							placeholder={t("dataHistory.backup.nameEmpty")}
						/>
					</div>
					<div className="mt-4">
						<p className="mb-1.5 text-xs text-muted-foreground">
							{t("dataHistory.detail.note")}
						</p>
						<HistoryNoteEditor
							note={backup.note}
							onSave={(note) =>
								updateMeta.mutate({ fileName: backup.fileName, note })
							}
							disabled={updateMeta.isPending}
						/>
					</div>
				</>
			) : backup.note !== undefined && backup.note.length > 0 ? (
				<p className="mt-4 border-l-2 border-border-strong pl-3 text-xs leading-5 text-secondary-foreground">
					{backup.note}
				</p>
			) : null}

			<div className="mt-5 flex flex-col gap-2">
				{isArchived ? (
					<>
						<Button
							variant="secondary"
							className="justify-center"
							data-testid={`download-${backup.fileName}`}
							nativeButton={false}
							render={
								<a href={apiPaths.backups.download(backup.fileName)}>
									<Icon icon={Download} />
									{t("dataHistory.action.download")}
								</a>
							}
						/>
						<p className="text-tiny leading-4 text-muted-foreground">
							{t("dataHistory.backup.archivedHint")}
						</p>
					</>
				) : (
					<>
						<Button
							className="justify-center"
							onClick={onRestore}
							disabled={isRestoring || isDeleting}
							data-testid={`restore-${backup.fileName}`}
						>
							<Icon icon={UndoRightRound} />
							{isRestoring
								? t("dataHistory.action.restoring")
								: t("dataHistory.action.restore")}
						</Button>
						<div className="flex gap-2">
							<Button
								variant="secondary"
								className="flex-1 justify-center"
								data-testid={`download-${backup.fileName}`}
								nativeButton={false}
								render={
									<a href={apiPaths.backups.download(backup.fileName)}>
										<Icon icon={Download} />
										{t("dataHistory.action.download")}
									</a>
								}
							/>
							<Button
								variant="danger"
								className="flex-1 justify-center"
								onClick={onDelete}
								disabled={isRestoring || isDeleting}
								data-testid={`delete-${backup.fileName}`}
							>
								<Icon icon={TrashBinMinimalistic} />
								{isDeleting
									? t("dataHistory.action.deleting")
									: t("dataHistory.action.delete")}
							</Button>
						</div>
						<p className="mt-1 text-tiny leading-4 text-muted-foreground">
							{t("dataHistory.backup.restoreHint")}
						</p>
					</>
				)}
			</div>
		</div>
	)
}
