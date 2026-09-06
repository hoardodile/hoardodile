import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { MetaChip } from "@hoardodile/ui/components/meta-chip"
import { Archive, Pen, UndoRightRound } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { useDateFormatter } from "@/features/settings/datePrefs"
import type { ArchiveEvent, DataHistoryList } from "./api"

export type DataHistoryTimelineProps = {
	readonly data: DataHistoryList
	readonly onSwitchVersion: (version: number) => void
	readonly onEdit: (archive: ArchiveEvent) => void
	readonly isSwitching: boolean
}

/**
 * One row per archive — no separate detail pane. The title line carries
 * version, name and state chips; the description (note) sits directly
 * under it. Actions live on the right: the current (writable) version
 * gets an edit button, every other non-viewed version a switch button
 * (the way back after switching to history).
 */
export function DataHistoryTimeline({
	data,
	onSwitchVersion,
	onEdit,
	isSwitching,
}: DataHistoryTimelineProps) {
	const { t } = useTranslation()
	const { formatDateTime } = useDateFormatter()
	const readOnly = data.activeVersion !== data.currentVersion
	return (
		<div className="divide-y divide-border" data-testid="data-history-timeline">
			{data.archives.map((archive) => {
				const editCurrent = archive.current && !readOnly
				const canSwitch = !archive.active && !editCurrent
				return (
					<div
						key={archive.version}
						className="flex flex-wrap items-center gap-3 py-3"
						data-testid={archive.id}
					>
						<div className="min-w-0 flex-1">
							<div className="flex min-w-0 items-center gap-2">
								<Archive className="size-4 shrink-0" />
								<span className="shrink-0 text-ui font-medium">
									v{archive.version}
								</span>
								{archive.name && (
									<span className="truncate text-ui">{archive.name}</span>
								)}
								<MetaChip tone={archive.current ? "inverse" : "bordered"}>
									{t(
										archive.current
											? "dataHistory.chip.latest"
											: "dataHistory.chip.readOnly",
									)}
								</MetaChip>
								{archive.active && (
									<span className="text-tiny text-muted-foreground">
										{t("dataHistory.archive.tagActiveShort")}
									</span>
								)}
							</div>
							{archive.note && archive.note.length > 0 && (
								<p className="mt-1 text-xs text-muted-foreground">
									{archive.note}
								</p>
							)}
						</div>
						{archive.createdAt !== undefined && (
							<span className="shrink-0 text-tiny text-muted-foreground">
								{formatDateTime(archive.createdAt)}
							</span>
						)}
						{editCurrent ? (
							<Button
								variant="secondary"
								size="sm"
								onClick={() => onEdit(archive)}
								data-testid={`edit-${archive.version}`}
							>
								<Icon icon={Pen} />
								{t("dataHistory.action.edit")}
							</Button>
						) : canSwitch ? (
							<Button
								variant="secondary"
								size="sm"
								onClick={() => onSwitchVersion(archive.version)}
								disabled={isSwitching}
								data-testid={`switch-${archive.version}`}
							>
								<Icon icon={UndoRightRound} />
								{isSwitching
									? t("dataHistory.action.switching")
									: t("dataHistory.action.switchToVersion")}
							</Button>
						) : null}
					</div>
				)
			})}
		</div>
	)
}
