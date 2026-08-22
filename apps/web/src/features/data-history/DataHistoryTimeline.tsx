import { MetaChip } from "@hoardodile/ui/components/meta-chip"
import { Archive, Server } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { memo } from "react"
import { useTranslation } from "react-i18next"
import { useDateFormatter } from "@/features/settings/datePrefs"
import { formatBytes } from "@/lib/formatBytes"
import type { BackupEvent, DataHistoryList, HistoryGroup } from "./api"

export type DataHistoryTimelineProps = {
	readonly data: DataHistoryList
	readonly selectedId: string | undefined
	readonly onSelect: (id: string) => void
}

/**
 * Vertical timeline that groups backups under the archive version they
 * were created against. Archives sit on the primary rail; backups branch
 * off the rail with a horizontal connector that meets the backup node
 * icon. Rows are borderless; the selected row takes the muted fill.
 */
export function DataHistoryTimeline(props: DataHistoryTimelineProps) {
	const { data, selectedId, onSelect } = props
	const { t } = useTranslation()

	if (data.groups.length === 0) {
		return (
			<div
				className="rounded-lg border border-dashed bg-muted/20 p-6 text-center"
				data-testid="data-history-empty"
			>
				<p className="text-sm text-muted-foreground">
					{t("dataHistory.empty.title")}
				</p>
				<p className="text-xs text-muted-foreground mt-1">
					{t("dataHistory.empty.description")}
				</p>
			</div>
		)
	}

	return (
		<div
			className="relative flex flex-col gap-6"
			data-testid="data-history-timeline"
		>
			{/* Continuous vertical spine behind all archive icons */}
			<div className="absolute top-2 bottom-2 left-4 w-px bg-border" />

			{data.groups.map((group) => {
				const isArchiveSelected = selectedId === group.archive.id
				const selectedBackupId =
					group.backups.find((b) => b.id === selectedId)?.id ?? undefined

				return (
					<TimelineGroup
						key={group.archive.version}
						group={group}
						isArchiveSelected={isArchiveSelected}
						selectedBackupId={selectedBackupId}
						isActiveVersion={group.archive.version === data.activeVersion}
						isCurrentVersion={group.archive.version === data.currentVersion}
						onSelect={onSelect}
					/>
				)
			})}
		</div>
	)
}

type TimelineGroupProps = {
	readonly group: HistoryGroup
	readonly isArchiveSelected: boolean
	readonly selectedBackupId: string | undefined
	readonly isActiveVersion: boolean
	readonly isCurrentVersion: boolean
	readonly onSelect: (id: string) => void
}

const TimelineGroup = memo(function TimelineGroup(props: TimelineGroupProps) {
	const {
		group,
		isArchiveSelected,
		selectedBackupId,
		isActiveVersion,
		isCurrentVersion,
		onSelect,
	} = props
	const { t } = useTranslation()
	const { formatDateTime } = useDateFormatter()
	const archive = group.archive

	return (
		<div className="relative">
			<div className="flex items-center gap-3">
				<span
					className={cn(
						"relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full",
						isActiveVersion
							? "bg-foreground text-background"
							: "bg-muted text-muted-foreground",
					)}
				>
					<Archive className="size-4" />
				</span>
				<button
					type="button"
					onClick={() => onSelect(archive.id)}
					className={cn(
						"flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 rounded-lg px-2 py-1.5 text-left",
						isArchiveSelected ? "bg-muted" : "hover:bg-muted",
					)}
					data-testid={archive.id}
				>
					<span className="shrink-0 text-ui font-semibold text-foreground">
						v{archive.version}
					</span>
					{archive.name !== undefined && archive.name.length > 0 ? (
						<span className="truncate text-ui text-secondary-foreground">
							{archive.name}
						</span>
					) : null}
					{isCurrentVersion ? (
						<MetaChip tone="inverse">{t("dataHistory.chip.latest")}</MetaChip>
					) : (
						<MetaChip tone="bordered">
							{t("dataHistory.chip.readOnly")}
						</MetaChip>
					)}
					{archive.createdAt !== undefined ? (
						<span className="ml-auto shrink-0 text-tiny text-muted-foreground">
							{formatDateTime(archive.createdAt)}
						</span>
					) : null}
				</button>
			</div>

			{/* Backup nodes nested under the archive */}
			{group.backups.length > 0 ? (
				<div className="mt-2 flex flex-col gap-1 pl-4">
					{group.backups.map((backup) => (
						<TimelineBackupNode
							key={backup.id}
							backup={backup}
							selected={selectedBackupId === backup.id}
							onSelect={() => onSelect(backup.id)}
						/>
					))}
				</div>
			) : null}
		</div>
	)
}, areTimelineGroupPropsEqual)

function areTimelineGroupPropsEqual(
	a: TimelineGroupProps,
	b: TimelineGroupProps,
): boolean {
	return (
		a.group === b.group &&
		a.isArchiveSelected === b.isArchiveSelected &&
		a.selectedBackupId === b.selectedBackupId &&
		a.isActiveVersion === b.isActiveVersion &&
		a.isCurrentVersion === b.isCurrentVersion &&
		a.onSelect === b.onSelect
	)
}

type TimelineBackupNodeProps = {
	readonly backup: BackupEvent
	readonly selected: boolean
	readonly onSelect: () => void
}

const TimelineBackupNode = memo(function TimelineBackupNode(
	props: TimelineBackupNodeProps,
) {
	const { backup, selected, onSelect } = props
	const { t } = useTranslation()
	const { formatDateTime } = useDateFormatter()

	return (
		<div className="flex items-center gap-3">
			{/* Connector from the spine to the backup node. */}
			<span className="relative flex size-8 shrink-0 items-center justify-center">
				<span className="absolute top-1/2 -left-4 h-px w-4 bg-border" />
				<span
					className={cn(
						"relative z-10 flex size-5 items-center justify-center rounded-full bg-background",
						selected ? "text-foreground" : "text-muted-foreground",
					)}
				>
					<Server className="size-4" />
				</span>
			</span>
			<button
				type="button"
				onClick={onSelect}
				className={cn(
					"flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 rounded-lg px-2 py-1.5 text-left",
					selected ? "bg-muted" : "hover:bg-muted",
				)}
				data-testid={backup.id}
			>
				<span className="truncate text-ui font-medium text-foreground">
					{backup.name ?? backup.fileName}
				</span>
				{backup.auto ? (
					<MetaChip tone="bordered">{t("dataHistory.chip.auto")}</MetaChip>
				) : null}
				{backup.name !== undefined && backup.name.length > 0 ? (
					<span className="shrink-0 text-tiny text-muted-foreground">
						{formatDateTime(backup.createdAt)}
					</span>
				) : null}
				<span className="ml-auto shrink-0 text-tiny text-muted-foreground tabular-nums">
					{formatBytes(backup.size)}
				</span>
			</button>
		</div>
	)
})
