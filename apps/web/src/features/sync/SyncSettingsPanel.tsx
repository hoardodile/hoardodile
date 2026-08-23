import type {
	SyncDevice,
	SyncDeviceSummary,
	SyncRecord,
} from "@hoardodile/schemas"
import {
	DEFAULT_SYNC_REMIND_DAYS,
	SYNC_REMIND_DAYS_OPTIONS,
} from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Icon } from "@hoardodile/ui/components/icon"
import { IconTile } from "@hoardodile/ui/components/icon-tile"
import { Input } from "@hoardodile/ui/components/input"
import { MetaChip } from "@hoardodile/ui/components/meta-chip"
import {
	AddCircle,
	Bell,
	MonitorSmartphone,
	Pen,
	RefreshCircle,
	TrashBinMinimalistic,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { numberCodec } from "@/features/prefs"
import { formatDateTime, useDatePrefs } from "@/features/settings/datePrefs"
import { SettingsSection } from "@/features/settings/SettingsSection"
import { usePref } from "@/hooks/usePref"
import { useToastMutation } from "@/hooks/useToastMutation"
import { formatBytes } from "@/lib/formatBytes"
import { prefKeys } from "@/lib/keys"
import {
	createSyncDeviceMutation,
	deleteSyncDeviceMutation,
	invalidateSync,
	recordSyncMutation,
	syncSummaryQueryOptions,
	updateSyncDeviceMutation,
} from "./api"

type StateKey =
	| "resourceCount"
	| "characterCount"
	| "documentCount"
	| "commentCount"
	| "tagCount"
	| "trashCount"
	| "storageBytes"
	| "resourceBytes"

type StateField = {
	readonly key: StateKey
	/** i18n key under `sync.fields`. */
	readonly labelKey:
		| "resources"
		| "characters"
		| "documents"
		| "messages"
		| "tags"
		| "trash"
		| "contentSize"
		| "storage"
	/** Whether the value is a byte count rendered via `formatBytes`. */
	readonly bytes: boolean
}

const STATE_FIELDS: readonly StateField[] = [
	{ key: "resourceCount", labelKey: "resources", bytes: false },
	{ key: "characterCount", labelKey: "characters", bytes: false },
	{ key: "documentCount", labelKey: "documents", bytes: false },
	{ key: "commentCount", labelKey: "messages", bytes: false },
	{ key: "tagCount", labelKey: "tags", bytes: false },
	{ key: "trashCount", labelKey: "trash", bytes: false },
	{ key: "resourceBytes", labelKey: "contentSize", bytes: true },
	{ key: "storageBytes", labelKey: "storage", bytes: true },
]

/**
 * Page-level actions — add a device and read the fleet's health at a
 * glance. Sits above the floating cards, the same rhythm as the Plugins
 * page.
 */
export function SyncPageActions() {
	const { t } = useTranslation()
	const summaryQuery = useQuery(syncSummaryQueryOptions())
	const devices = summaryQuery.data?.devices ?? []
	const dueCount = devices.filter((device) => device.due).length

	const [adding, setAdding] = useState(false)
	const [newName, setNewName] = useState("")
	const [newNotes, setNewNotes] = useState("")

	const addMut = useToastMutation({
		...createSyncDeviceMutation(),
		invalidate: (qc) => invalidateSync(qc),
		onSuccess() {
			setAdding(false)
			setNewName("")
			setNewNotes("")
		},
		successToastKey: "sync.toast.deviceAdded",
		errorToastKey: "sync.toast.deviceAddFailed",
	})

	function submitAdd() {
		if (newName.trim() === "") return
		addMut.mutate({ name: newName.trim(), notes: newNotes.trim() })
	}

	return (
		<>
			<div className="mb-3 flex items-center justify-between gap-4">
				<Button onClick={() => setAdding(true)} data-testid="sync-device-add">
					<Icon icon={AddCircle} />
					{t("sync.devices.add")}
				</Button>
				<span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-secondary-foreground">
					<span
						className={cn(
							"size-1.5 rounded-full",
							dueCount > 0 ? "bg-destructive" : "bg-emerald-500",
						)}
					/>
					{dueCount > 0
						? t("sync.status.dueCount", {
								count: dueCount,
								total: devices.length,
							})
						: t("sync.status.allUpToDate")}
				</span>
			</div>
			<p className="mb-3 -mt-2 text-tiny text-muted-foreground">
				{t("sync.pageHint")}
			</p>

			<AppDialog
				open={adding}
				onOpenChange={(open) => {
					if (!open) setAdding(false)
				}}
				title={t("sync.devices.addTitle")}
				footer={
					<>
						<Button
							variant="secondary"
							disabled={addMut.isPending}
							onClick={() => setAdding(false)}
						>
							{t("common.cancel")}
						</Button>
						<Button
							disabled={addMut.isPending || newName.trim() === ""}
							onClick={submitAdd}
							data-testid="sync-device-add-confirm"
						>
							{addMut.isPending
								? t("sync.devices.addPending")
								: t("sync.devices.add")}
						</Button>
					</>
				}
			>
				<div className="flex flex-col gap-3">
					<p className="text-xs text-muted-foreground">
						{t("sync.devices.addAutoRecord")}
					</p>
					<label
						htmlFor="sync-add-name"
						className="flex flex-col gap-1 text-xs text-muted-foreground"
					>
						{t("sync.devices.namePlaceholder")}
						<Input
							id="sync-add-name"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							size="sm"
							placeholder={t("sync.devices.nameHint")}
							data-testid="sync-device-name"
						/>
					</label>
					<label
						htmlFor="sync-add-notes"
						className="flex flex-col gap-1 text-xs text-muted-foreground"
					>
						{t("sync.devices.notesPlaceholder")}
						<Input
							id="sync-add-notes"
							value={newNotes}
							onChange={(e) => setNewNotes(e.target.value)}
							size="sm"
							placeholder={t("sync.devices.notesHint")}
							data-testid="sync-device-notes"
						/>
					</label>
				</div>
			</AppDialog>
		</>
	)
}

/**
 * Sync-device settings: the reminder interval as its own compact card,
 * then one floating card per device with its snapshot states and
 * per-device reminder. Each card shows the latest snapshot and what
 * changed since the previous one. The feature only stores records — it
 * never talks to any sync software.
 */
export function SyncSettingsPanel() {
	const { t } = useTranslation()
	const { timeZone } = useDatePrefs()
	const [remindDays, setRemindDays] = usePref(
		prefKeys.syncRemindDays,
		DEFAULT_SYNC_REMIND_DAYS,
		numberCodec(),
	)
	const summaryQuery = useQuery(syncSummaryQueryOptions())
	const devices = summaryQuery.data?.devices

	const [editing, setEditing] = useState<SyncDevice | null>(null)
	const [editName, setEditName] = useState("")
	const [editNotes, setEditNotes] = useState("")
	const [deleting, setDeleting] = useState<SyncDevice | null>(null)

	const updateMut = useToastMutation({
		...updateSyncDeviceMutation(),
		invalidate: (qc) => invalidateSync(qc),
		onSuccess() {
			setEditing(null)
		},
		successToastKey: "sync.toast.deviceUpdated",
		errorToastKey: "sync.toast.deviceUpdateFailed",
	})

	const deleteMut = useToastMutation({
		...deleteSyncDeviceMutation(),
		invalidate: (qc) => invalidateSync(qc),
		onSuccess() {
			setDeleting(null)
		},
		successToastKey: "sync.toast.deviceDeleted",
		errorToastKey: "sync.toast.deviceDeleteFailed",
	})

	const recordMut = useToastMutation({
		...recordSyncMutation(),
		invalidate: (qc) => invalidateSync(qc),
		successToastKey: "sync.toast.recorded",
		errorToastKey: "sync.toast.recordFailed",
	})

	useEffect(() => {
		if (editing !== null) {
			setEditName(editing.name)
			setEditNotes(editing.notes)
		}
	}, [editing])

	function submitEdit() {
		if (editing === null || editName.trim() === "") return
		updateMut.mutate({
			id: editing.id,
			name: editName.trim(),
			notes: editNotes.trim(),
		})
	}

	return (
		<div className="flex flex-col gap-4">
			{/* Reminder interval — the page's only config, kept as its own
			    compact card; the device cards float separately. */}
			<div className="rounded-2xl border border-border bg-card p-6 shadow-card">
				<SettingsSection
					icon={Bell}
					title={t("sync.config.remindLabel")}
					description={t("sync.config.remindDescription")}
					layout="compact"
					data-testid="sync-config-card"
				>
					<DropdownSelect
						value={String(remindDays)}
						onValueChange={(value) => setRemindDays(Number(value))}
						options={SYNC_REMIND_DAYS_OPTIONS.map((days) => ({
							value: String(days),
							label: t("sync.config.remindDays", { count: days }),
						}))}
						placeholder={t("sync.config.remindLabel")}
						aria-label={t("sync.config.remindLabel")}
						data-testid="sync-remind-days"
					/>
				</SettingsSection>
			</div>

			{devices === undefined ? (
				<p className="text-xs text-muted-foreground">
					{t("sync.devices.loading")}
				</p>
			) : devices.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					{t("sync.devices.empty")}
				</p>
			) : (
				devices.map((entry) => (
					<SyncDeviceCard
						key={entry.device.id}
						entry={entry}
						timeZone={timeZone}
						recordPending={recordMut.isPending}
						onRecord={() => recordMut.mutate({ deviceId: entry.device.id })}
						onEdit={() => setEditing(entry.device)}
						onDelete={() => setDeleting(entry.device)}
					/>
				))
			)}

			<p
				className="text-xs text-muted-foreground"
				data-testid="sync-one-way-tip"
			>
				{t("sync.tip.oneWay")}
			</p>

			<AppDialog
				open={editing !== null}
				onOpenChange={(open) => {
					if (!open) setEditing(null)
				}}
				title={t("sync.devices.editTitle")}
				footer={
					<>
						<Button
							variant="secondary"
							disabled={updateMut.isPending}
							onClick={() => setEditing(null)}
						>
							{t("common.cancel")}
						</Button>
						<Button
							disabled={updateMut.isPending || editName.trim() === ""}
							onClick={submitEdit}
							data-testid="sync-device-save"
						>
							{updateMut.isPending
								? t("sync.devices.editPending")
								: t("sync.devices.save")}
						</Button>
					</>
				}
			>
				<div className="flex flex-col gap-3">
					<label
						htmlFor="sync-edit-name"
						className="flex flex-col gap-1 text-xs text-muted-foreground"
					>
						{t("sync.devices.namePlaceholder")}
						<Input
							id="sync-edit-name"
							value={editName}
							onChange={(e) => setEditName(e.target.value)}
							size="sm"
							placeholder={t("sync.devices.nameHint")}
							data-testid="sync-edit-name"
						/>
					</label>
					<label
						htmlFor="sync-edit-notes"
						className="flex flex-col gap-1 text-xs text-muted-foreground"
					>
						{t("sync.devices.notesPlaceholder")}
						<Input
							id="sync-edit-notes"
							value={editNotes}
							onChange={(e) => setEditNotes(e.target.value)}
							size="sm"
							placeholder={t("sync.devices.notesHint")}
							data-testid="sync-edit-notes"
						/>
					</label>
				</div>
			</AppDialog>

			<ConfirmDialog
				open={deleting !== null}
				onOpenChange={(open) => {
					if (!open) setDeleting(null)
				}}
				title={t("sync.devices.deleteTitle", { name: deleting?.name ?? "" })}
				description={t("sync.devices.deleteDescription")}
				confirmLabel={t("sync.devices.delete")}
				pendingLabel={t("sync.devices.deletePending")}
				isPending={deleteMut.isPending}
				destructive
				onConfirm={() => {
					if (deleting !== null) deleteMut.mutate(deleting.id)
				}}
				confirmTestId="sync-device-delete-confirm"
			/>
		</div>
	)
}

/**
 * One sync device — a floating card, the Archive detail card's anatomy:
 * an icon tile + name header, health and management on the right, the
 * snapshot states as a two-column table of changes since the previous
 * sync. Deltas read by direction: success when the state grew, danger
 * when it shrank.
 */
function SyncDeviceCard(props: {
	readonly entry: SyncDeviceSummary
	readonly timeZone: string
	readonly recordPending: boolean
	readonly onRecord: () => void
	readonly onEdit: () => void
	readonly onDelete: () => void
}) {
	const { t } = useTranslation()
	const { entry, timeZone, recordPending, onRecord, onEdit, onDelete } = props
	const {
		device,
		latestRecord,
		previousRecord,
		lastRecordedAt,
		elapsedDays,
		due,
	} = entry

	return (
		<div
			className="rounded-xl border border-border bg-card p-5 shadow-card"
			data-testid={`sync-device-card-${device.id}`}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<IconTile icon={MonitorSmartphone} size={40} iconSize="lg" />
					<div className="min-w-0">
						<div className="flex items-baseline gap-2">
							<span className="text-ui font-semibold text-foreground">
								{device.name}
							</span>
							{device.notes !== "" ? (
								<span className="truncate text-xs text-muted-foreground">
									{device.notes}
								</span>
							) : null}
						</div>
						<p className="mt-0.5 text-xs text-muted-foreground">
							{lastRecordedAt === undefined ? (
								t("sync.devices.neverSynced")
							) : (
								<LastSyncedLabel
									lastRecordedAt={lastRecordedAt}
									elapsedDays={elapsedDays}
									timeZone={timeZone}
								/>
							)}
						</p>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<DevicePill entry={entry} />
					<Button
						variant="secondary"
						onClick={onEdit}
						data-testid={`sync-device-edit-${device.id}`}
					>
						<Icon icon={Pen} />
						{t("sync.devices.edit")}
					</Button>
					<Button
						variant="danger"
						onClick={onDelete}
						data-testid={`sync-device-delete-${device.id}`}
					>
						<Icon icon={TrashBinMinimalistic} />
						{t("sync.devices.delete")}
					</Button>
				</div>
			</div>

			{latestRecord !== undefined ? (
				<SnapshotStats record={latestRecord} previous={previousRecord} />
			) : null}

			<div className="mt-4 flex justify-end">
				<Button
					variant="secondary"
					disabled={recordPending}
					onClick={onRecord}
					data-testid={`sync-record-${device.id}`}
				>
					<Icon icon={RefreshCircle} />
					{due ? t("sync.devices.recordNow") : t("sync.devices.record")}
				</Button>
			</div>
		</div>
	)
}

/** Device health pill — success dot when fresh, danger when the reminder
    interval passed without a snapshot. */
function DevicePill({ entry }: { entry: SyncDeviceSummary }) {
	const { t } = useTranslation()
	const { due, elapsedDays, latestRecord } = entry
	const neverSynced = latestRecord === undefined
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
				due
					? "bg-destructive/10 text-destructive"
					: "bg-emerald-500/10 text-emerald-600",
			)}
		>
			<span
				className={cn(
					"size-1.5 rounded-full",
					due ? "bg-destructive" : "bg-emerald-500",
				)}
			/>
			{due
				? neverSynced
					? t("sync.devices.neverBadge")
					: t("sync.devices.overdue", { count: elapsedDays ?? 0 })
				: t("sync.devices.upToDate")}
		</span>
	)
}

const MINUTE_MS = 60 * 1000

/**
 * "Last synced" freshness line: relative while recent (just now /
 * minutes / hours), absolute date from one day on. The absolute
 * timestamp stays available on hover. Recomputed every render, so the
 * 60s summary refetch keeps it live.
 */
function LastSyncedLabel(props: {
	readonly lastRecordedAt: number
	readonly elapsedDays: number | undefined
	readonly timeZone: string
}) {
	const { t } = useTranslation()
	const { lastRecordedAt, elapsedDays, timeZone } = props
	const minutes = Math.floor((Date.now() - lastRecordedAt) / MINUTE_MS)
	const hours = Math.floor(minutes / 60)
	const label =
		minutes < 1
			? t("sync.devices.justNow")
			: minutes < 60
				? t("sync.devices.minutesAgo", { count: minutes })
				: hours < 24
					? t("sync.devices.hoursAgo", { count: hours })
					: t("sync.devices.lastSyncedAgo", {
							date: formatDateTime(
								lastRecordedAt,
								"YYYY-MM-DD HH:mm",
								timeZone,
							),
							count: elapsedDays ?? Math.floor(hours / 24),
						})
	return (
		<span title={formatDateTime(lastRecordedAt, "YYYY-MM-DD HH:mm", timeZone)}>
			{label}
		</span>
	)
}

/**
 * Latest snapshot with per-state deltas against the previous one. Rows
 * with no change drop the delta; the very first snapshot carries a
 * "first sync" marker instead.
 */
function SnapshotStats(props: {
	readonly record: SyncRecord
	readonly previous: SyncRecord | undefined
}) {
	const { t } = useTranslation()
	const { record, previous } = props
	return (
		<ul className="mt-4 grid grid-cols-2 gap-x-8">
			{STATE_FIELDS.map((field) => {
				const { key, labelKey, bytes } = field
				const current = record[key]
				const prev = previous?.[key]
				const delta = prev === undefined ? undefined : current - prev
				return (
					<li
						key={key}
						className="flex min-h-nav items-center justify-between gap-3 border-t border-border px-1 text-ui"
						aria-label={t(`sync.fields.${labelKey}`)}
					>
						<span className="text-muted-foreground">
							{t(`sync.fields.${labelKey}`)}
						</span>
						<span className="flex items-center gap-2 tabular-nums">
							{formatStateValue(bytes, current)}
							{delta === undefined ? (
								<MetaChip>{t("sync.fields.firstRecord")}</MetaChip>
							) : delta === 0 ? null : (
								<span
									className={
										delta > 0 ? "text-emerald-600" : "text-destructive"
									}
									data-testid={`sync-delta-${key}`}
								>
									{formatDelta(bytes, delta)}
								</span>
							)}
						</span>
					</li>
				)
			})}
		</ul>
	)
}

function formatStateValue(bytes: boolean, value: number): string {
	return bytes ? formatBytes(value) : String(value)
}

function formatDelta(bytes: boolean, delta: number): string {
	const sign = delta > 0 ? "+" : "−"
	const magnitude = bytes
		? formatBytes(Math.abs(delta))
		: String(Math.abs(delta))
	return `${sign}${magnitude}`
}
