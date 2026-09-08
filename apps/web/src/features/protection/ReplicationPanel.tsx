import { SYNC_REMIND_DAYS_OPTIONS } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Icon } from "@hoardodile/ui/components/icon"
import { Input } from "@hoardodile/ui/components/input"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { Switch } from "@hoardodile/ui/components/switch"
import {
	Server,
	TransferHorizontal,
	UserMinus,
} from "@hoardodile/ui/icons/registry"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsSection } from "@/features/settings/SettingsSection"
import { SectionDivider } from "@/features/settings/SettingsSheet"
import { syncSummaryQueryOptions } from "@/features/sync/api"
import { useToastMutation } from "@/hooks/useToastMutation"
import { trpcMutation } from "@/trpc/factory"
import { protectionStatusOptions, replicationStatusOptions } from "./api"
import { ConnectSenderButton, PairingInviteButton } from "./PairingButtons"
import { ReceivedBackup } from "./ReceivedBackup"

type Connection = { id: string; name: string; receivedAt: number | null }
type Removal = {
	kind: "disconnect" | "revoke"
	connectionId?: string
	name: string
}

/**
 * Backup-sync settings — the paired-device half of the merged backups
 * tab: the service (role/name/pause), pairing actions, and the connected
 * devices list. External manual sync records are gone; paired devices
 * carry their own names and receipts.
 *
 * `embedded` renders the same content without the enclosing
 * SettingsSections, so the merged "Protection" section can host the
 * offsite-copy block inline. Standalone (default) keeps the two sections
 * for the existing tests/usages.
 */
export function ReplicationPanel({ embedded = false }: { embedded?: boolean }) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const stateQuery = useQuery(replicationStatusOptions())
	const state = stateQuery.data
	const protection = useQuery(protectionStatusOptions()).data
	const lastRestore = protection?.lastRestore
	const canInvite = Boolean(protection?.lastBackupAt)
	const canSend = Boolean(protection?.lastBackupAt)
	// A device can only act as a sender (share its own backups) once it holds a
	// local backup. Keep `send` when it is already the current role so a sender
	// whose backups were later pruned still shows itself as such.
	const roleOptions = (["unconfigured", "send", "receive"] as const)
		.filter((role) => role !== "send" || canSend || state?.role === "send")
		.map((role) => ({ value: role, label: t(`replicationUx.${role}`) }))
	const summary = useQuery(syncSummaryQueryOptions()).data
	const [name, setName] = useState("")
	const [removing, setRemoving] = useState<Removal | null>(null)
	const [setupMode, setSetupMode] = useState<"send" | "receive" | null>(null)
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
	const remind = useToastMutation({
		...trpcMutation("sync", "remindDays"),
		onSuccess: invalidate,
	})
	const connections: Connection[] = state?.source
		? [state.source]
		: (state?.peers ?? [])

	const serviceBody = (
		<div className="space-y-5">
			{stateQuery.isPending && (
				<div
					className="space-y-3"
					data-testid="replication-skeleton"
					aria-hidden
				>
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-24 w-full" />
				</div>
			)}
			{stateQuery.error && <p role="alert">{stateQuery.error.message}</p>}
			{state?.role === "unconfigured" && (
				<section
					className="space-y-4"
					aria-label={t("replicationUx.unconfigured")}
				>
					<div className="grid gap-3">
						{canSend && (
							<button
								type="button"
								data-testid="setup-sync-send"
								className="flex w-full flex-col items-start gap-1 rounded-lg bg-secondary px-4 py-4 text-left text-foreground transition-colors hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
								onClick={() => setSetupMode("send")}
							>
								<span className="text-ui font-medium">
									{t("replicationUx.send")}
								</span>
								<span className="text-xs text-secondary-foreground">
									{t("replicationUx.sendHelp")}
								</span>
							</button>
						)}
						<button
							type="button"
							data-testid="setup-sync-receive"
							className="flex w-full flex-col items-start gap-1 rounded-lg bg-secondary px-4 py-4 text-left text-foreground transition-colors hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
							onClick={() => setSetupMode("receive")}
						>
							<span className="text-ui font-medium">
								{t("replicationUx.receive")}
							</span>
							<span className="text-xs text-secondary-foreground">
								{t("replicationUx.receiveHelp")}
							</span>
						</button>
					</div>
					{!canSend && (
						<p className="text-xs text-secondary-foreground">
							{t("protectionUx.sendRequiresBackup")}
						</p>
					)}
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
								options={roleOptions}
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
								disabled={receive.isPending || state.receiving || state.paused}
								onClick={() => receive.mutate(undefined)}
							>
								{t("replication.receiveNow")}
							</Button>
						)}
					</div>
					{state.source && <ReceivedBackup source={state.source} />}
				</>
			)}
		</div>
	)

	const devicesBody = (
		<div className="space-y-4">
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
					onValueChange={(days) => remind.mutate({ days: Number(days) })}
				/>
			</div>
			<div className="divide-y divide-border">
				{connections.map((connection) => (
					<div
						key={connection.id}
						className="flex flex-wrap items-center gap-3 py-4"
						data-testid={`sync-device-${connection.id}`}
					>
						<div className="min-w-0 flex-1">
							<p className="text-ui">{connection.name}</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{t("replication.paired")} ·{" "}
								{connection.receivedAt
									? `${t("replication.received")}: ${new Date(connection.receivedAt).toLocaleString()}`
									: t("replication.never")}
							</p>
							{lastRestore?.repositoryId === connection.id && (
								<p className="mt-1 text-xs text-muted-foreground">
									{t("protection.lastRestore")}:{" "}
									{new Date(lastRestore.restoredAt).toLocaleString()} ·{" "}
									{lastRestore.pointId.slice(0, 8)}
									<br />
									{t("protection.restoredEditable")}
								</p>
							)}
						</div>
						{connection.id === state?.source?.id ? (
							<Button
								variant="secondary"
								onClick={() =>
									setRemoving({
										kind: "disconnect",
										name: connection.name,
									})
								}
							>
								{t("replication.disconnect")}
							</Button>
						) : (
							<Button
								variant="secondary"
								onClick={() =>
									setRemoving({
										kind: "revoke",
										connectionId: connection.id,
										name: connection.name,
									})
								}
							>
								<Icon icon={UserMinus} />
								{t("replication.revoke")}
							</Button>
						)}
					</div>
				))}
			</div>
		</div>
	)

	const dialogs = (
		<>
			<AppDialog
				open={setupMode !== null}
				onOpenChange={(open) => {
					if (!open) setSetupMode(null)
				}}
				title={
					setupMode === "send"
						? t("replicationUx.send")
						: t("replicationUx.receive")
				}
				footer={
					<>
						<Button
							variant="secondary"
							disabled={configure.isPending}
							onClick={() => setSetupMode(null)}
						>
							{t("backupSetup.cancel")}
						</Button>
						<Button
							disabled={configure.isPending}
							onClick={() => {
								const role = setupMode === "send" ? "send" : "receive"
								configure.mutate(
									{
										role,
										name: name.trim() || state?.name || "",
										paused: false,
									},
									{ onSuccess: () => setSetupMode(null) },
								)
							}}
						>
							{configure.isPending ? t("common.working") : t("common.confirm")}
						</Button>
					</>
				}
			>
				<p className="text-xs text-secondary-foreground">
					{setupMode === "send"
						? t("replicationUx.sendHelp")
						: t("replicationUx.receiveHelp")}
				</p>
			</AppDialog>
			<ConfirmDialog
				open={removing !== null}
				onOpenChange={(open) => {
					if (!open) setRemoving(null)
				}}
				title={t(
					removing?.kind === "disconnect"
						? "replication.disconnect"
						: "replication.revoke",
				)}
				description={removing?.name}
				confirmLabel={t(
					removing?.kind === "disconnect"
						? "replication.disconnect"
						: "replication.revoke",
				)}
				isPending={revoke.isPending || disconnect.isPending}
				onConfirm={() => {
					if (!removing) return
					if (removing.kind === "disconnect") disconnect.mutate(undefined)
					else if (removing.connectionId)
						revoke.mutate({ id: removing.connectionId })
				}}
			/>
		</>
	)

	if (embedded) {
		return (
			<div data-testid="backup-sync">
				{serviceBody}
				{connections.length > 0 && <div className="mt-5">{devicesBody}</div>}
				{dialogs}
			</div>
		)
	}

	return (
		<div data-testid="backup-sync">
			<SettingsSection
				icon={TransferHorizontal}
				title={t("replication.title")}
				description={t("replication.description")}
				layout="stack"
				data-testid="replication-service-section"
			>
				{serviceBody}
			</SettingsSection>
			{connections.length > 0 && (
				<>
					<SectionDivider />
					<SettingsSection
						icon={Server}
						title={t("replication.devices")}
						layout="stack"
						data-testid="replication-devices-section"
					>
						{devicesBody}
					</SettingsSection>
				</>
			)}
			{dialogs}
		</div>
	)
}
