import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { IconTile } from "@hoardodile/ui/components/icon-tile"
import { MetaChip } from "@hoardodile/ui/components/meta-chip"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { Archive, Pen, UndoRightRound } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { useDateFormatter } from "@/features/settings/datePrefs"
import { formatBytes } from "@/lib/formatBytes"
import type { ArchiveEvent, DataHistoryList } from "./api"

export type DataHistoryCardsProps = {
	readonly data: DataHistoryList
	readonly onSwitchVersion: (version: number) => void
	readonly onEdit: (archive: ArchiveEvent) => void
	readonly isSwitching: boolean
}

/** Shared with the skeleton so the placeholder can never drift from the
    grid; the column ladder is the marketplace/plugins one. */
const GRID_CLASS = "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
const CARD_SHELL = "flex flex-col gap-2.5 rounded-xl border border-border p-4"
const CARD_CLASS = `${CARD_SHELL} relative overflow-hidden transition-colors hover:bg-accent/40`

/**
 * One sheet-flat card per archive — the backup recovery-point and
 * marketplace card anatomy (icon tile, title, mono meta line, note,
 * banners/chips, actions in one bordered box) instead of a divided row
 * list. The writable current version wears the marketplace's "installed"
 * top banner; historical ones carry the read-only chip.
 * There is still no detail pane: the card is the whole interaction, and
 * the actions stay exactly where they were — edit for the writable
 * current version, switch for every other non-viewed version (the way
 * back after switching to history).
 */
export function DataHistoryCards({
	data,
	onSwitchVersion,
	onEdit,
	isSwitching,
}: DataHistoryCardsProps) {
	const readOnly = data.activeVersion !== data.currentVersion
	return (
		<div className={GRID_CLASS} data-testid="data-history-cards">
			{data.archives.map((archive) => (
				<ArchiveCard
					key={archive.version}
					archive={archive}
					readOnly={readOnly}
					onSwitchVersion={onSwitchVersion}
					onEdit={onEdit}
					isSwitching={isSwitching}
				/>
			))}
		</div>
	)
}

/** Loading placeholder — skeleton cards mirroring the card anatomy. */
export function DataHistoryCardsSkeleton() {
	return (
		<div className={GRID_CLASS} data-testid="data-history-skeleton" aria-hidden>
			{Array.from({ length: 4 }, (_, index) => (
				<div key={index} className={CARD_SHELL}>
					<div className="flex items-center gap-2.5">
						<Skeleton className="size-8 shrink-0 rounded-lg" />
						<div className="min-w-0 flex-1">
							<Skeleton className="mb-1.5 h-4 w-2/3" />
							<Skeleton className="h-3 w-1/3" />
						</div>
					</div>
					<Skeleton className="h-3 w-4/5" />
					<div className="flex items-center justify-between">
						<Skeleton className="h-4 w-14" />
						<Skeleton className="h-7 w-20 rounded-md" />
					</div>
				</div>
			))}
		</div>
	)
}

/**
 * One archive card: version and name on the title line, date and on-disk
 * size on the mono meta line, the note under it, then the state chips and
 * the single action the archive can offer.
 */
function ArchiveCard({
	archive,
	readOnly,
	onSwitchVersion,
	onEdit,
	isSwitching,
}: {
	readonly archive: ArchiveEvent
	readonly readOnly: boolean
	readonly onSwitchVersion: (version: number) => void
	readonly onEdit: (archive: ArchiveEvent) => void
	readonly isSwitching: boolean
}) {
	const { t } = useTranslation()
	const { formatDateTime } = useDateFormatter()
	const editCurrent = archive.current && !readOnly
	const canSwitch = !archive.active && !editCurrent
	const title = archive.name
		? `v${archive.version} · ${archive.name}`
		: `v${archive.version}`
	const meta = [
		archive.createdAt === undefined
			? undefined
			: formatDateTime(archive.createdAt),
		formatBytes(archive.dbSize),
	]
		.filter(Boolean)
		.join(" · ")
	return (
		<div className={CARD_CLASS} data-testid={archive.id}>
			{/* Same banner the marketplace card wears for installed plugins —
			    the writable current archive is the "latest" one. */}
			{archive.current && (
				<span
					className="pointer-events-none absolute inset-x-0 top-0 flex h-3 items-center justify-center bg-foreground text-tiny font-semibold text-background"
					data-testid={`archive-latest-banner-${archive.version}`}
				>
					{t("dataHistory.chip.latest")}
				</span>
			)}
			<div className="flex items-center gap-2.5">
				<IconTile icon={Archive} />
				<div className="min-w-0 flex-1">
					<span className="block truncate text-ui font-medium" title={title}>
						{title}
					</span>
					<span className="block truncate font-mono text-tiny text-muted-foreground">
						{meta}
					</span>
				</div>
			</div>
			{archive.note && archive.note.length > 0 && (
				<p className="line-clamp-2 text-xs text-muted-foreground">
					{archive.note}
				</p>
			)}
			{/* The row wraps so a long switch label (de, zh) drops to its own
			    line inside the card instead of overflowing the column. */}
			<div className="flex min-w-0 flex-wrap items-center gap-1.5">
				{!archive.current && (
					<MetaChip tone="bordered">{t("dataHistory.chip.readOnly")}</MetaChip>
				)}
				{archive.active && (
					<MetaChip tone="muted">{t("dataHistory.archive.tagActive")}</MetaChip>
				)}
				{(editCurrent || canSwitch) && (
					<div className="ml-auto flex shrink-0 items-center gap-2">
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
						) : (
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
						)}
					</div>
				)}
			</div>
		</div>
	)
}
