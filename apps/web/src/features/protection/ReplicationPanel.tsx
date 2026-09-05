import { SYNC_REMIND_DAYS_OPTIONS } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Input } from "@hoardodile/ui/components/input"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
	SectionDivider,
	SettingsSheet,
} from "@/features/settings/SettingsSheet"
import {
	syncCurrentQueryOptions,
	syncSummaryQueryOptions,
} from "@/features/sync/api"
import { useToastMutation } from "@/hooks/useToastMutation"
import { getDesktopBridge } from "@/lib/desktop"
import type { RouterOutputs } from "@/trpc/client"
import { trpcMutation } from "@/trpc/factory"
import { protectionStatusOptions, replicationStatusOptions } from "./api"
import { ProtectionJobs } from "./ProtectionJobs"

type ManualDevice = RouterOutputs["sync"]["summary"]["devices"][number]
type Connection = { id: string; name: string; receivedAt: number | null }

export function ReplicationPanel() {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const state = useQuery(replicationStatusOptions()).data
	const lastRestore = useQuery(protectionStatusOptions()).data?.lastRestore
	const summary = useQuery(syncSummaryQueryOptions()).data
	const records = summary?.devices ?? []
	const current = useQuery(syncCurrentQueryOptions()).data
	const [name, setName] = useState("")
	const [connecting, setConnecting] = useState(false)
	const [url, setUrl] = useState("")
	const [code, setCode] = useState("")
	const [fingerprint, setFingerprint] = useState("")
	const [invitation, setInvitation] = useState<{
		code: string
		expiresAt: number
	} | null>(null)
	const [advertisedUrl, setAdvertisedUrl] = useState(
		window.location.protocol === "https:" ? window.location.origin : "",
	)
	const [advertisedFingerprint, setAdvertisedFingerprint] = useState("")
	const [editing, setEditing] = useState<{
		id?: string
		name: string
		notes: string
	} | null>(null)
	const [removing, setRemoving] = useState<{
		recordId?: string
		connectionId?: string
		name: string
	} | null>(null)
	const [linking, setLinking] = useState<Connection | null>(null)
	const [recordId, setRecordId] = useState("")
	const [details, setDetails] = useState<ManualDevice | null>(null)
	useEffect(() => {
		if (state?.name) setName(state.name)
	}, [state?.name])
	useEffect(() => {
		if (!invitation) return
		void getDesktopBridge()
			?.getLanInfo()
			.then((info) => {
				const address = info.addresses[0]?.address
				if (info.enabled && info.https && address) {
					setAdvertisedUrl(
						`https://${address.includes(":") ? `[${address}]` : address}:${info.lanHttpsPort}`,
					)
					setAdvertisedFingerprint(info.fingerprint ?? "")
				}
			})
	}, [invitation])
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
	const invite = useToastMutation({
		...trpcMutation("replication", "invitation"),
		onSuccess: setInvitation,
	})
	const connect = useToastMutation({
		...trpcMutation("replication", "connect"),
		onSuccess: async () => {
			setConnecting(false)
			setCode("")
			await invalidate()
		},
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
	const rows: {
		id: string
		name: string
		manual?: ManualDevice
		connection?: Connection
	}[] = records.map((entry) => ({
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
	return (
		<SettingsSheet>
			<div className="space-y-5" data-testid="backup-sync">
				<header>
					<h2 className="text-lg font-medium">{t("replication.title")}</h2>
					<p className="mt-1 text-xs text-secondary-foreground">
						{t("replication.description")}
					</p>
				</header>
				{state && (
					<>
						<div className="flex flex-wrap items-end gap-3">
							<label
								htmlFor="replication-service-name"
								className="space-y-1 text-xs"
							>
								<span>{t("replication.name")}</span>
								<Input
									id="replication-service-name"
									value={name}
									onChange={(event) => setName(event.target.value)}
								/>
							</label>
							<Button
								variant="secondary"
								disabled={
									!name.trim() || name === state.name || configure.isPending
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
							<DropdownSelect
								value={state.role}
								aria-label={t("replication.role")}
								disabled={
									Boolean(state.source || state.peers.length) ||
									configure.isPending
								}
								options={(["unconfigured", "send", "receive"] as const).map(
									(role) => ({ value: role, label: t(`replication.${role}`) }),
								)}
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
							<label className="flex items-center gap-2 text-xs">
								<input
									type="checkbox"
									checked={state.paused}
									onChange={(event) =>
										configure.mutate({
											role: state.role,
											name: state.name,
											paused: event.target.checked,
										})
									}
								/>
								{t("replication.paused")}
							</label>
						</div>
						<div className="flex flex-wrap gap-2">
							{state.role === "send" && (
								<Button
									disabled={invite.isPending}
									onClick={() => invite.mutate(undefined)}
								>
									{t("replication.invite")}
								</Button>
							)}
							{state.role !== "send" && !state.source && (
								<Button onClick={() => setConnecting(true)}>
									{t("replication.connect")}
								</Button>
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
							<Button
								variant="secondary"
								onClick={() => setEditing({ name: "", notes: "" })}
								data-testid="sync-device-add"
							>
								{t("replication.addRecord")}
							</Button>
						</div>
					</>
				)}
				<SectionDivider />
				<h3 className="text-ui font-medium">{t("replication.devices")}</h3>
				<div className="flex items-center gap-3 text-xs">
					<span>{t("sync.config.remindLabel")}</span>
					<DropdownSelect
						value={String(summary?.remindDays ?? 7)}
						disabled={remind.isPending}
						options={SYNC_REMIND_DAYS_OPTIONS.map((days) => ({
							value: String(days),
							label: t("sync.config.remindDays", { count: days }),
						}))}
						onValueChange={(days) => remind.mutate({ days: Number(days) })}
					/>
				</div>
				{rows.length === 0 && (
					<p className="text-xs text-muted-foreground">
						{t("replication.noDevices")}
					</p>
				)}
				<div className="divide-y divide-border">
					{rows.map((row) => (
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
											? new Date(row.manual.lastRecordedAt).toLocaleString()
											: t("protection.never")}
								</p>
								{row.manual?.device.notes && (
									<p className="mt-1 text-xs">{row.manual.device.notes}</p>
								)}
								{row.connection &&
									lastRestore?.repositoryId === row.connection.id && (
										<p className="mt-1 text-xs text-muted-foreground">
											{t("protection.lastRestore")}:{" "}
											{new Date(lastRestore.restoredAt).toLocaleString()} ·{" "}
											{lastRestore.pointId.slice(0, 8)}
											<br />
											{t("protection.restoredEditable")}
										</p>
									)}
							</div>
							{row.manual && (
								<>
									<Button
										variant="ghost"
										onClick={() =>
											setEditing({
												id: row.manual!.device.id,
												name: row.manual!.device.name,
												notes: row.manual!.device.notes,
											})
										}
									>
										{t("protection.metadata")}
									</Button>
									<Button
										variant="ghost"
										onClick={() => setDetails(row.manual!)}
									>
										{t("replication.details")}
									</Button>
									{!row.connection && (
										<Button
											variant="secondary"
											disabled={record.isPending}
											onClick={() =>
												record.mutate({ deviceId: row.manual!.device.id })
											}
										>
											{t("replication.record")}
										</Button>
									)}
								</>
							)}
							{row.connection && (
								<Button
									variant="ghost"
									onClick={() => {
										if (row.manual)
											link.mutate({
												recordId: row.manual.device.id,
												instanceId: null,
											})
										else {
											setLinking(row.connection!)
											setRecordId("")
										}
									}}
								>
									{row.manual ? t("replication.unlink") : t("replication.link")}
								</Button>
							)}
							<Button
								variant="ghost"
								onClick={() =>
									setRemoving({
										recordId: row.connection
											? undefined
											: row.manual?.device.id,
										connectionId: row.connection?.id,
										name: row.name,
									})
								}
							>
								{row.connection
									? t("replication.revoke")
									: t("replication.remove")}
							</Button>
						</div>
					))}
				</div>
				<SectionDivider />
				<ProtectionJobs />
			</div>
			<AppDialog
				open={connecting}
				onOpenChange={setConnecting}
				title={t("replication.connect")}
				description={t("replication.connectHelp")}
				footer={
					<Button
						disabled={
							connect.isPending || !url.trim() || code.trim().length < 32
						}
						onClick={() =>
							connect.mutate({
								url: url.trim(),
								code: code.trim(),
								fingerprint: fingerprint.trim() || undefined,
							})
						}
					>
						{t("replication.connect")}
					</Button>
				}
			>
				<div className="space-y-3">
					<Input
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						placeholder={t("replication.url")}
						aria-label={t("replication.url")}
					/>
					<Input
						value={code}
						onChange={(event) => setCode(event.target.value)}
						placeholder={t("replication.code")}
						aria-label={t("replication.code")}
						autoComplete="off"
					/>
					<Input
						value={fingerprint}
						onChange={(event) => setFingerprint(event.target.value)}
						placeholder={t("replication.fingerprint")}
						aria-label={t("replication.fingerprint")}
					/>
				</div>
			</AppDialog>
			<AppDialog
				open={invitation !== null}
				onOpenChange={(open) => {
					if (!open) setInvitation(null)
				}}
				title={t("replication.invite")}
				description={t("replication.inviteHelp")}
			>
				{invitation && (
					<div className="space-y-3">
						<Input
							value={advertisedUrl}
							onChange={(event) => setAdvertisedUrl(event.target.value)}
							placeholder={t("replication.url")}
							aria-label={t("replication.url")}
						/>
						<Input
							readOnly
							value={invitation.code}
							aria-label={t("replication.code")}
							onFocus={(event) => event.target.select()}
						/>
						{advertisedFingerprint && (
							<Input
								readOnly
								value={advertisedFingerprint}
								aria-label={t("replication.fingerprint")}
								onFocus={(event) => event.target.select()}
							/>
						)}
						{!advertisedUrl && (
							<p className="text-xs">{t("replication.addressHelp")}</p>
						)}
						<p className="text-xs text-muted-foreground">
							{new Date(invitation.expiresAt).toLocaleString()}
						</p>
					</div>
				)}
			</AppDialog>
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
				title={t("replication.remove")}
				description={removing?.name}
				confirmLabel={t("replication.remove")}
				isPending={
					deleteRecord.isPending || revoke.isPending || disconnect.isPending
				}
				onConfirm={() => {
					if (removing?.recordId) deleteRecord.mutate({ id: removing.recordId })
					else if (removing?.connectionId === state?.source?.id)
						disconnect.mutate(undefined)
					else if (removing?.connectionId)
						revoke.mutate({ id: removing.connectionId })
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
		</SettingsSheet>
	)
}
