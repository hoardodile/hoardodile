import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { IconTile } from "@hoardodile/ui/components/icon-tile"
import { History, UndoRightRound } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { useDateFormatter } from "@/features/settings/datePrefs"
import { useToastMutation } from "@/hooks/useToastMutation"
import {
	type ArchiveEvent,
	type DataHistoryList,
	dataHistoryKeys,
	updateVersionMetaMutation,
} from "./api"
import { HistoryNoteEditor } from "./HistoryNoteEditor"
import { InlineNameEditor } from "./InlineNameEditor"

export type DataHistoryDetailProps = {
	readonly data: DataHistoryList
	readonly selectedId: string | undefined
	readonly onSwitchVersion: (version: number) => void
	readonly isSwitching: boolean
}
export function DataHistoryDetail({
	data,
	selectedId,
	onSwitchVersion,
	isSwitching,
}: DataHistoryDetailProps) {
	const { t } = useTranslation()
	const selected = data.archives.find((entry) => entry.id === selectedId)
	if (!selected)
		return (
			<p
				className="p-5 text-xs text-muted-foreground"
				data-testid="data-history-empty-detail"
			>
				{t("dataHistory.detail.selectPrompt")}
			</p>
		)
	return (
		<ArchiveDetail
			archive={selected}
			onSwitch={() => onSwitchVersion(selected.version)}
			isSwitching={isSwitching}
		/>
	)
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
	readonly archive: ArchiveEvent
	readonly onSwitch: () => void
	readonly isSwitching: boolean
}

function ArchiveDetail(props: ArchiveDetailProps) {
	const { archive, onSwitch, isSwitching } = props
	const { t } = useTranslation()
	const { formatDateTime } = useDateFormatter()
	const canEditMeta = archive.current && archive.active

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
			</div>
		</div>
	)
}
