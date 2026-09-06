import { SYNC_REMIND_DAYS_OPTIONS } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import {
	Empty,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@hoardodile/ui/components/empty"
import { Icon } from "@hoardodile/ui/components/icon"
import { Input } from "@hoardodile/ui/components/input"
import { Switch } from "@hoardodile/ui/components/switch"
import { More } from "@hoardodile/ui/icons/actions"
import {
	InfoCircle,
	Link,
	Pen,
	Server,
	TransferHorizontal,
	TrashBinMinimalistic,
	UserMinus,
} from "@hoardodile/ui/icons/registry"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link as RouterLink } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsSection } from "@/features/settings/SettingsSection"
import { SectionDivider } from "@/features/settings/SettingsSheet"
import {
	syncCurrentQueryOptions,
	syncSummaryQueryOptions,
} from "@/features/sync/api"
import { useToastMutation } from "@/hooks/useToastMutation"
import type { RouterOutputs } from "@/trpc/client"
import { trpcMutation } from "@/trpc/factory"
import { protectionStatusOptions, replicationStatusOptions } from "./api"
import { ConnectSenderButton, PairingInviteButton } from "./PairingButtons"
import { ProtectionJobs } from "./ProtectionJobs"
import { ReceivedBackup } from "./ReceivedBackup"

type ManualDevice = RouterOutputs["sync"]["summary"]["devices"][number]
type Connection = { id: string; name: string; receivedAt: number | null }
type Row = {
	id: string
	name: string
	manual?: ManualDevice
	connection?: Connection
}
type Removal = {
	kind: "unlink" | "revoke" | "disconnect" | "remove"
	recordId?: string
	connectionId?: string
	name: string
}

export function ReplicationPanel() {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const stateQuery = useQuery(replicationStatusOptions())
	const state = stateQuery.data
	const protection = useQuery(protectionStatusOptions()).data
	const lastRestore = protection?.lastRestore
	const canInvite = Boolean(protection?.lastBackupAt)
	const summary = useQuery(syncSummaryQueryOptions()).data
	const records = summary?.devices ?? []
	const current = useQuery(syncCurrentQueryOptions()).data
	const [name, setName] = useState("")
	const [editing, setEditing] = useState<{
		id?: string
		name: string
		notes: string
	} | null>(null)
	const [removing, setRemoving] = useState<Removal | null>(null)
	const [linking, setLinking] = useState<Connection | null>(null)
	const [recordId, setRecordId] = useState("")
	const [details, setDetails] = useState<ManualDevice | null>(null)
	useEffect(() => {
		if (state?.name) setName(state.name)
	}, [state?.name])
	const invalidate = async () => {
		await Promise.all([
			qc.invalidateQueries({ queryKey: ["replication"] }),
			qc.invalidateQueries({ queryKey: ["sync"] }),
			qc.invalidateQueries({ queryKey: ["protection"] }),
		])
	}
	const configure = useToastMutation({
		...trpcMutation("replication", "configure"),
		onSuccess: invalidate,
	})
	const disconnect = useToastMutation({
		...trpcMutation("replication", "disconnect"),
		onSuccess: async () => {
			setRemoving(null)
			await invalidate()
		},
	})
	const revoke = useToastMutation({
		...trpcMutation("replication", "revoke"),
		onSuccess: async () => {
			setRemoving(null)
			await invalidate()
		},
	})
	const receive = useToastMutation({
		...trpcMutation("replication", "receive"),
		onSuccess: invalidate,
	})
	const createRecord = useToastMutation({
		...trpcMutation("sync", "deviceCreate"),
		onSuccess: async () => {
			setEditing(null)
			await invalidate()
		},
	})
	const updateRecord = useToastMutation({
		...trpcMutation("sync", "deviceUpdate"),
		onSuccess: async () => {
			setEditing(null)
			await invalidate()
		},
	})
	const deleteRecord = useToastMutation({
		...trpcMutation("sync", "deviceDelete"),
		onSuccess: async () => {
			setRemoving(null)
			await invalidate()
		},
	})
	const record = useToastMutation({
		...trpcMutation("sync", "recordCreate"),
		onSuccess: invalidate,
	})
	const remind = useToastMutation({
		...trpcMutation("sync", "remindDays"),
		onSuccess: invalidate,
	})
	const link = useToastMutation({
		...trpcMutation("replication", "linkDevice"),
		onSuccess: async () => {
			setLinking(null)
			await invalidate()
		},
	})
	const connections: Connection[] = state?.source
		? [state.source]
		: (state?.peers ?? [])
	const links = state?.links ?? {}
	const rows: Row[] = records.map((entry) => ({
		id: entry.device.id,
		name: entry.device.name,
		manual: entry,
		connection: connections.find((peer) => peer.id === links[entry.device.id]),
	}))
	for (const connection of connections)
		if (!rows.some((row) => row.connection?.id === connection.id))
			rows.push({ id: connection.id, name: connection.name, connection })
	function saveRecord() {
		if (!editing?.name.trim()) return
		if (editing.id)
			updateRecord.mutate({
				id: editing.id,
				name: editing.name.trim(),
				notes: editing.notes,
			})
		else
			createRecord.mutate({ name: editing.name.trim(), notes: editing.notes })
	}
	function rowActions(row: Row) {
		const menu = (
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={t("me.custom.more")}
						>
							<Icon icon={More} size="sm" />
						</Button>
					}
				/>
				<DropdownMenuContent align="end" className="min-w-48">
					{row.manual && (
						<>
							<DropdownMenuItem
								onClick={() =>
									setEditing({
										id: row.manual!.device.id,
										name: row.manual!.device.name,
										notes: row.manual!.device.notes,
									})
								}
							>
								<Icon icon={Pen} />
								{t("protection.metadata")}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setDetails(row.manual!)}>
								<Icon icon={InfoCircle} />
								{t("replication.details")}
							</DropdownMenuItem>
						</>
					)}
					{row.connection && row.manual && (
						<DropdownMenuItem
							onClick={() =>
								setRemoving({
									kind: "unlink",
									recordId: row.manual!.device.id,
									name: row.name,
								})
							}
						>
							<Icon icon={Link} />
							{t("replication.unlink")}
						</DropdownMenuItem>
					)}
					<DropdownMenuItem
						variant="destructive"
						onClick={() =>
							row.connection
								? setRemoving({
										kind:
											row.connection.id === state?.source?.id
												? "disconnect"
												: "revoke",
										connectionId: row.connection.id,
										name: row.name,
									})
								: setRemoving({
										kind: "remove",
										recordId: row.manual!.device.id,
										name: row.name,
									})
						}
					>
						<Icon icon={row.connection ? UserMinus : TrashBinMinimalistic} />
						{row.connection ? t("replication.revoke") : t("replication.remove")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		)
		if (row.connection && row.manual) return menu
		return (
			<div className="flex shrink-0 items-center gap-2">
				<Button
					variant="secondary"
					disabled={row.manual ? record.isPending : false}
					onClick={() => {
						if (row.manual) record.mutate({ deviceId: row.manual.device.id })
						else {
							setLinking(row.connection!)
							setRecordId("")
						}
					}}
				>
					{row.manual ? t("replication.record") : t("replication.link")}
				</Button>
				{menu}
			</div>
		)
	}
	return (
		<>
			<div data-testid="backup-sync">
				<SettingsSection
					icon={TransferHorizontal}
					title={t("replication.title")}
					description={t("replication.description")}
					layout="stack"
					data-testid="replication-service-section"
				>
					<div className="space-y-5">
						{stateQuery.isPending && <p>{t("common.loading")}</p>}
						{stateQuery.error && <p role="alert">{stateQuery.error.message}</p>}
						{state?.role === "unconfigured" && (
							<section className="space-y-3">
								<p className="text-ui font-medium">
									{t("replicationUx.unconfigured")}
								</p>
								<div className="flex flex-wrap gap-3">
									<Button
										disabled={configure.isPending}
										onClick={() =>
											configure.mutate({
												role: "send",
												name: state.name,
												paused: false,
											})
										}
									>
										{t("replicationUx.send")}
									</Button>
									<Button
										variant="secondary"
										disabled={configure.isPending}
										onClick={() =>
											configure.mutate({
												role: "receive",
												name: state.name,
												paused: false,
											})
										}
									>
										{t("replicationUx.receive")}
									</Button>
								</div>
							</section>
						)}
						{state && state.role !== "unconfigured" && (
							<>
								<div className="flex flex-col gap-4">
									<div className="flex flex-wrap items-center justify-between gap-3">
										<label
											htmlFor="replication-service-name"
											className="text-ui font-semibold text-foreground"
										>
											{t("replication.name")}
										</label>
										<div className="flex shrink-0 items-center gap-2">
											<Input
												id="replication-service-name"
												className="w-56"
												value={name}
												onChange={(event) => setName(event.target.value)}
											/>
											<Button
												variant="secondary"
												disabled={
													!name.trim() ||
													name === state.name ||
													configure.isPending
												}
												onClick={() =>
													configure.mutate({
														role: state.role,
														name,
														paused: state.paused,
													})
												}
											>
												{t("protection.save")}
											</Button>
										</div>
									</div>
									<div className="flex flex-wrap items-center justify-between gap-3">
										<span className="text-ui font-semibold text-foreground">
											{t("replication.role")}
										</span>
										<DropdownSelect
											value={state.role}
											aria-label={t("replication.role")}
											disabled={
												Boolean(state.source || state.peers.length) ||
												configure.isPending
											}
											options={(
												["unconfigured", "send", "receive"] as const
											).map((role) => ({
												value: role,
												label: t(`replicationUx.${role}`),
											}))}
											onValueChange={(role) => {
												if (
													role === "unconfigured" ||
													role === "send" ||
													role === "receive"
												)
													configure.mutate({
														role,
														name: name.trim() || state.name,
														paused: state.paused,
													})
											}}
										/>
									</div>
									<div className="flex flex-wrap items-center justify-between gap-3">
										<span className="text-ui font-semibold text-foreground">
											{t("replication.paused")}
										</span>
										<Switch
											checked={state.paused}
											onCheckedChange={(checked) =>
												configure.mutate({
													role: state.role,
													name: state.name,
													paused: checked,
												})
											}
											aria-label={t("replication.paused")}
										/>
									</div>
								</div>
								<p className="text-xs text-secondary-foreground">
									{t(
										state.role === "send"
											? "replicationUx.sendHelp"
											: "replicationUx.receiveHelp",
									)}
								</p>
								<div className="flex flex-wrap gap-2">
									{state.role === "send" && (
										<PairingInviteButton disabled={!canInvite} />
									)}
									{state.role !== "send" && !state.source && (
										<ConnectSenderButton onConnected={invalidate} />
									)}
									{state.source && (
										<Button
											disabled={
												receive.isPending || state.receiving || state.paused
											}
											onClick={() => receive.mutate(undefined)}
										>
											{t("replication.receiveNow")}
										</Button>
									)}
								</div>
								{state.role === "send" && !canInvite && (
									<RouterLink
										to="/settings/backups"
										className="text-xs underline"
									>
										{t("protectionUx.start")}
									</RouterLink>
								)}
								{state.source && <ReceivedBackup source={state.source} />}
							</>
						)}
						<ProtectionJobs activeOnly />
					</div>
				</SettingsSection>
				<SectionDivider />
				<SettingsSection
					icon={Server}
					title={t("replication.devices")}
					layout="stack"
					data-testid="replication-devices-section"
				>
					<div className="space-y-4">
						{rows.length > 0 && (
							<div className="flex flex-wrap items-center justify-between gap-3">
								<span className="text-ui font-semibold text-foreground">
									{t("sync.config.remindLabel")}
								</span>
								<DropdownSelect
									value={String(summary?.remindDays ?? 7)}
									disabled={remind.isPending}
									options={SYNC_REMIND_DAYS_OPTIONS.map((days) => ({
										value: String(days),
										label: t("sync.config.remindDays", { count: days }),
									}))}
									onValueChange={(days) =>
										remind.mutate({ days: Number(days) })
									}
								/>
							</div>
						)}
						{rows.length === 0 ? (
							<Empty className="py-8">
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<Icon icon={Server} className="size-6" />
									</EmptyMedia>
									<EmptyTitle>{t("replication.noDevices")}</EmptyTitle>
								</EmptyHeader>
							</Empty>
						) : (
							<div className="divide-y divide-border">
								{rows
									.filter((row) => row.connection)
									.map((row) => (
										<div
											key={row.id}
											className="flex flex-wrap items-center gap-3 py-4"
											data-testid={`sync-device-${row.id}`}
										>
											<div className="min-w-0 flex-1">
												<p className="text-ui">{row.name}</p>
												<p className="mt-1 text-xs text-muted-foreground">
													{row.connection
														? t("replication.paired")
														: t("replication.recordOnly")}{" "}
													·{" "}
													{row.connection
														? row.connection.receivedAt
															? `${t("replication.received")}: ${new Date(row.connection.receivedAt).toLocaleString()}`
															: t("replication.never")
														: row.manual?.lastRecordedAt
															? new Date(
																	row.manual.lastRecordedAt,
																).toLocaleString()
															: t("protection.never")}
												</p>
												{row.manual?.device.notes && (
													<p className="mt-1 text-xs">
														{row.manual.device.notes}
													</p>
												)}
												{row.connection &&
													lastRestore?.repositoryId === row.connection.id && (
														<p className="mt-1 text-xs text-muted-foreground">
															{t("protection.lastRestore")}:{" "}
															{new Date(
																lastRestore.restoredAt,
															).toLocaleString()}{" "}
															· {lastRestore.pointId.slice(0, 8)}
															<br />
															{t("protection.restoredEditable")}
														</p>
													)}
											</div>
											{rowActions(row)}
										</div>
									))}
							</div>
						)}
						<div className="space-y-3" data-testid="external-sync-records">
							<div>
								<h3 className="text-ui font-semibold text-foreground">
									{t("replicationUx.externalRecords")} (
									{rows.filter((row) => !row.connection).length})
								</h3>
								<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
									{t("replicationUx.externalHelp")}
								</p>
							</div>
							<Button
								variant="secondary"
								onClick={() => setEditing({ name: "", notes: "" })}
								data-testid="sync-device-add"
							>
								{t("replicationUx.externalRecord")}
							</Button>
							<div className="divide-y divide-border">
								{rows
									.filter((row) => !row.connection && row.manual)
									.map((row) => (
										<div
											key={row.id}
											className="flex flex-wrap items-center gap-3 py-3"
											data-testid={`sync-device-${row.id}`}
										>
											<div className="min-w-0 flex-1">
												<p className="text-ui">{row.name}</p>
												<p className="text-xs text-muted-foreground">
													{t("replication.recordOnly")} ·{" "}
													{row.manual?.lastRecordedAt
														? new Date(
																row.manual.lastRecordedAt,
															).toLocaleString()
														: t("protection.never")}
												</p>
											</div>
											{rowActions(row)}
										</div>
									))}
							</div>
						</div>
					</div>
				</SettingsSection>
			</div>
			<AppDialog
				open={editing !== null}
				onOpenChange={(open) => {
					if (!open) setEditing(null)
				}}
				title={t("replication.recordOnly")}
				footer={
					<Button
						disabled={
							!editing?.name.trim() ||
							createRecord.isPending ||
							updateRecord.isPending
						}
						onClick={saveRecord}
					>
						{t("protection.save")}
					</Button>
				}
			>
				{editing && (
					<div className="space-y-3">
						<Input
							value={editing.name}
							onChange={(event) =>
								setEditing({ ...editing, name: event.target.value })
							}
							aria-label={t("protection.name")}
							placeholder={t("protection.name")}
						/>
						<Input
							value={editing.notes}
							onChange={(event) =>
								setEditing({ ...editing, notes: event.target.value })
							}
							aria-label={t("protection.note")}
							placeholder={t("protection.note")}
						/>
					</div>
				)}
			</AppDialog>
			<ConfirmDialog
				open={removing !== null}
				onOpenChange={(open) => {
					if (!open) setRemoving(null)
				}}
				title={t(
					removing?.kind === "unlink"
						? "replication.unlink"
						: removing?.kind === "revoke"
							? "replication.revoke"
							: removing?.kind === "disconnect"
								? "replication.disconnect"
								: "replication.remove",
				)}
				description={removing?.name}
				confirmLabel={t(
					removing?.kind === "unlink"
						? "replication.unlink"
						: removing?.kind === "revoke"
							? "replication.revoke"
							: removing?.kind === "disconnect"
								? "replication.disconnect"
								: "replication.remove",
				)}
				isPending={
					deleteRecord.isPending ||
					revoke.isPending ||
					disconnect.isPending ||
					link.isPending
				}
				onConfirm={() => {
					if (!removing) return
					switch (removing.kind) {
						case "unlink":
							if (removing.recordId)
								link.mutate({
									recordId: removing.recordId,
									instanceId: null,
								})
							break
						case "disconnect":
							disconnect.mutate(undefined)
							break
						case "revoke":
							if (removing.connectionId)
								revoke.mutate({ id: removing.connectionId })
							break
						case "remove":
							if (removing.recordId)
								deleteRecord.mutate({ id: removing.recordId })
							break
					}
				}}
			/>
			<AppDialog
				open={linking !== null}
				onOpenChange={(open) => {
					if (!open) setLinking(null)
				}}
				title={t("replication.link")}
				description={t("replication.linkDescription")}
				footer={
					<Button
						disabled={!recordId || !linking || link.isPending}
						onClick={() => {
							if (linking) link.mutate({ recordId, instanceId: linking.id })
						}}
					>
						{t("replication.link")}
					</Button>
				}
			>
				<DropdownSelect
					value={recordId}
					onValueChange={setRecordId}
					options={records
						.filter((entry) => !links[entry.device.id])
						.map((entry) => ({
							value: entry.device.id,
							label: entry.device.name,
						}))}
					placeholder={t("replication.recordOnly")}
				/>
			</AppDialog>
			<AppDialog
				open={details !== null}
				onOpenChange={(open) => {
					if (!open) setDetails(null)
				}}
				title={details?.device.name ?? t("replication.details")}
			>
				{details && (
					<div className="space-y-2 text-xs">
						{(
							[
								["resourceCount", "resources"],
								["characterCount", "characters"],
								["documentCount", "documents"],
								["folderCount", "folders"],
								["commentCount", "messages"],
								["tagCount", "tags"],
								["collectionCount", "collections"],
								["trashCount", "trash"],
							] as const
						).map(([field, label]) => (
							<div key={field} className="flex justify-between">
								<span>{t(`sync.fields.${label}`)}</span>
								<span>
									{details.latestRecord?.[field] ?? "—"} →{" "}
									{current?.[field] ?? "—"}
								</span>
							</div>
						))}
					</div>
				)}
			</AppDialog>
		</>
	)
}
