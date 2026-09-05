import { MetaChip } from "@hoardodile/ui/components/meta-chip"
import { Archive } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useTranslation } from "react-i18next"
import { useDateFormatter } from "@/features/settings/datePrefs"
import type { DataHistoryList } from "./api"

export type DataHistoryTimelineProps = {
	readonly data: DataHistoryList
	readonly selectedId: string | undefined
	readonly onSelect: (id: string) => void
}
export function DataHistoryTimeline({
	data,
	selectedId,
	onSelect,
}: DataHistoryTimelineProps) {
	const { t } = useTranslation()
	const { formatDateTime } = useDateFormatter()
	return (
		<div className="divide-y divide-border" data-testid="data-history-timeline">
			{data.archives.map((archive) => (
				<button
					key={archive.version}
					type="button"
					onClick={() => onSelect(archive.id)}
					aria-pressed={selectedId === archive.id}
					className={cn(
						"flex min-h-nav w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left",
						selectedId === archive.id ? "bg-muted" : "hover:bg-muted",
					)}
					data-testid={archive.id}
				>
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
					{archive.createdAt !== undefined && (
						<span className="ml-auto shrink-0 text-tiny text-muted-foreground">
							{formatDateTime(archive.createdAt)}
						</span>
					)}
				</button>
			))}
		</div>
	)
}
