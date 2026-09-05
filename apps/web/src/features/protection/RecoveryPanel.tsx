import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { ConfirmByTypingDialog } from "@hoardodile/ui/components/confirm-by-typing-dialog"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Input } from "@hoardodile/ui/components/input"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { SectionDivider } from "@/features/settings/SettingsSheet"
import { useToastMutation } from "@/hooks/useToastMutation"
import { formatBytes } from "@/lib/formatBytes"
import type { RouterOutputs } from "@/trpc/client"
import { trpcMutation, trpcQueryOptions } from "@/trpc/factory"
import {
	downloadRecoveryKey,
	protectionStatusOptions,
	type RecoveryPoint,
	recoveryPointsOptions,
} from "./api"
import { FileComparison } from "./FileComparison"
import { ProtectionJobs } from "./ProtectionJobs"

type Policy = RouterOutputs["protection"]["status"]["policy"]
type RestorePlan = RouterOutputs["protection"]["prepareRestore"]

export function RecoveryPanel() {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const status = useQuery(protectionStatusOptions())
	const [repositoryId, setRepositoryId] = useState("local")
	const configured =
		status.data?.repositories.some((entry) => entry.id === repositoryId) ??
		false
	const points = useQuery({
		...recoveryPointsOptions(repositoryId),
		enabled: configured,
	})
	const [recoveryKey, setRecoveryKey] = useState("")
	const [creating, setCreating] = useState(false)
	const [name, setName] = useState("")
	const [note, setNote] = useState("")
	const [editing, setEditing] = useState<RecoveryPoint | null>(null)
	const [restorePlan, setRestorePlan] = useState<RestorePlan | null>(null)
	const [typed, setTyped] = useState("")
	const [policy, setPolicy] = useState<Policy | null>(null)
	const [cleanupOpen, setCleanupOpen] = useState(false)
	const [drillPoint, setDrillPoint] = useState<RecoveryPoint | null>(null)
	const [fullDrill, setFullDrill] = useState(false)
	const [drillTarget, setDrillTarget] = useState<"local" | "external">("local")
	const [deletePoint, setDeletePoint] = useState<RecoveryPoint | null>(null)
	const [reclaim, setReclaim] = useState(false)
	const [comparison, setComparison] = useState<{
		jobId: string
		pointId: string
		repositoryId: string
	} | null>(null)
	const invalidate = async () => {
		await qc.invalidateQueries({ queryKey: ["protection"] })
	}
	const initialize = useToastMutation({
		...trpcMutation("protection", "initialize"),
		onSuccess: invalidate,
	})
	const backup = useToastMutation({
		...trpcMutation("protection", "backup"),
		onSuccess: async () => {
			setCreating(false)
			setName("")
			setNote("")
			await invalidate()
		},
	})
	const check = useToastMutation({
		...trpcMutation("protection", "check"),
		onSuccess: invalidate,
	})
	const drill = useToastMutation({
		...trpcMutation("protection", "drill"),
		onSuccess: async () => {
			setDrillPoint(null)
			await invalidate()
		},
	})
	const remove = useToastMutation({
		...trpcMutation("protection", "deletePoint"),
		onSuccess: async () => {
			setDeletePoint(null)
			await invalidate()
		},
	})
	const compare = useToastMutation({
		...trpcMutation("protection", "compare"),
		onSuccess: async (job, input) => {
			setComparison({
				jobId: job.id,
				pointId: input.pointId,
				repositoryId: input.repositoryId,
			})
			await invalidate()
		},
	})
	const metadata = useToastMutation({
		...trpcMutation("protection", "metadata"),
		onSuccess: async () => {
			setEditing(null)
			await invalidate()
		},
	})
	const prepareRestore = useToastMutation({
		...trpcMutation("protection", "prepareRestore"),
		onSuccess: (plan) => {
			setRestorePlan(plan)
			setTyped("")
		},
	})
	const restore = useToastMutation({
		...trpcMutation("protection", "restore"),
		onSuccess: async () => {
			setRestorePlan(null)
			await invalidate()
			await qc.invalidateQueries({ queryKey: ["library-maintenance"] })
		},
	})
	const key = useToastMutation({
		...trpcMutation("protection", "recoveryKey"),
		onSuccess: (value) => downloadRecoveryKey(value, value.repositoryId),
		successToastKey: "protection.recoveryKeySaved",
	})
	const setEnabled = useToastMutation({
		...trpcMutation("protection", "enabled"),
		onSuccess: invalidate,
	})
	const savePolicy = useToastMutation({
		...trpcMutation("protection", "policy"),
		onSuccess: async () => {
			setPolicy(null)
			await invalidate()
		},
	})
	const cleanup = useToastMutation({
		...trpcMutation("protection", "retention"),
		onSuccess: async () => {
			setCleanupOpen(false)
			await invalidate()
		},
	})
	const cleanupPreview = useQuery({
		...trpcQueryOptions({
			namespace: "protection",
			procedure: "previewRetention",
			input: { repositoryId },
			queryKey: ["protection", "retention", repositoryId],
		}),
		enabled: cleanupOpen && configured,
	})
	const localConfigured =
		status.data?.repositories.some((entry) => entry.id === "local") ?? false
	const maintenance = Boolean(
		status.data?.maintenance ||
			status.data?.maintenanceError ||
			status.data?.maintenanceActive,
	)
	const lastContentCheckAt = status.data?.repositories.find(
		(entry) => entry.id === repositoryId,
	)?.lastContentCheckAt
	const activePolicy = policy ?? status.data?.policy
	return (
		<div className="space-y-5" data-testid="complete-backups">
			<div>
				<h2 className="text-lg font-medium">{t("protection.title")}</h2>
				<p className="mt-1 text-xs text-secondary-foreground">
					{t("protection.description")}
				</p>
			</div>
			{status.isPending && <p>{t("protection.loading")}</p>}
			{status.error && <p role="alert">{status.error.message}</p>}
			{status.data && (
				<p className="break-all text-xs text-muted-foreground">
					{t("protection.folder")}: {status.data.backupRoot}
				</p>
			)}
			{!localConfigured && !maintenance && (
				<div className="flex flex-wrap gap-3">
					<Input
						type="password"
						value={recoveryKey}
						onChange={(event) => setRecoveryKey(event.target.value)}
						placeholder={t("protection.importKey")}
						aria-label={t("protection.importKey")}
						className="max-w-md"
					/>
					<Button
						disabled={initialize.isPending}
						onClick={() =>
							initialize.mutate({
								recoveryKey: recoveryKey.trim() || undefined,
							})
						}
						data-testid="initialize-backups"
					>
						{t("protection.initialize")}
					</Button>
				</div>
			)}
			{localConfigured && (
				<div className="flex flex-wrap items-center gap-3">
					<Button
						disabled={backup.isPending || maintenance}
						onClick={() => {
							setName("")
							setNote("")
							setCreating(true)
						}}
						data-testid="complete-backup-now"
					>
						{t("protection.create")}
					</Button>
					<label className="flex items-center gap-2 text-xs">
						<input
							type="checkbox"
							checked={status.data?.enabled ?? false}
							onChange={(event) =>
								setEnabled.mutate({ enabled: event.target.checked })
							}
						/>
						{t("protection.automatic")}
					</label>
				</div>
			)}
			{status.data?.storage.frozen && (
				<p role="status" className="rounded-lg bg-muted p-3 text-xs">
					{t("protection.waitingFiles")}
				</p>
			)}
			{(status.data?.repositories.length ?? 0) > 0 && (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<DropdownSelect
							value={repositoryId}
							onValueChange={(id) => {
								setRepositoryId(id)
								setComparison(null)
							}}
							options={status.data!.repositories.map((entry) => ({
								value: entry.id,
								label: entry.name,
							}))}
							aria-label={t("protection.repository")}
						/>
						<Button
							variant="secondary"
							disabled={!configured || check.isPending}
							onClick={() => check.mutate({ repositoryId, readData: false })}
						>
							{t("protection.check")}
						</Button>
						<Button
							variant="secondary"
							disabled={!configured || check.isPending}
							onClick={() => check.mutate({ repositoryId, readData: true })}
						>
							{t("protection.checkFull")}
						</Button>
						<Button
							variant="ghost"
							disabled={!configured || key.isPending}
							onClick={() => key.mutate({ repositoryId })}
						>
							{t("protection.key")}
						</Button>
					</div>
					<p className="text-xs text-muted-foreground">
						{t("protection.keyHelp")}
					</p>
					<p className="text-xs text-muted-foreground">
						{t("protection.lastCheck")}:{" "}
						{lastContentCheckAt
							? new Date(lastContentCheckAt).toLocaleString()
							: t("protection.never")}
					</p>
					{points.error && <p role="alert">{points.error.message}</p>}
					<div className="divide-y divide-border">
						{points.data?.map((point) => (
							<div
								key={point.id}
								className="flex flex-wrap items-center gap-3 py-3"
								data-testid={`recovery-point-${point.id}`}
							>
								<div className="min-w-0 flex-1">
									<p className="truncate text-ui">
										{point.name || new Date(point.createdAt).toLocaleString()}
									</p>
									<p className="text-xs text-muted-foreground">
										{new Date(point.createdAt).toLocaleString()} ·{" "}
										{t(`protection.${point.kind}`)}
										{point.totalBytes !== undefined
											? ` · ${formatBytes(point.totalBytes)}`
											: ""}
										{point.pinned ? ` · ${t("protection.pinned")}` : ""}
									</p>
									{point.note && <p className="mt-1 text-xs">{point.note}</p>}
								</div>
								<Button
									variant="ghost"
									disabled={compare.isPending || maintenance}
									onClick={() =>
										compare.mutate({ repositoryId, pointId: point.id })
									}
								>
									{t("protection.compare")}
								</Button>
								<Button variant="ghost" onClick={() => setEditing(point)}>
									{t("protection.metadata")}
								</Button>
								<Button
									variant="ghost"
									disabled={maintenance}
									onClick={() => {
										setDrillPoint(point)
										setFullDrill(false)
									}}
								>
									{t("protection.drill")}
								</Button>
								<Button
									variant="ghost"
									disabled={maintenance || points.data.length <= 1}
									onClick={() => setDeletePoint(point)}
								>
									{t("replication.remove")}
								</Button>
								<Button
									variant="secondary"
									disabled={prepareRestore.isPending}
									onClick={() =>
										prepareRestore.mutate({ repositoryId, pointId: point.id })
									}
								>
									{t("protection.restore")}
								</Button>
							</div>
						))}
					</div>
					{points.data?.length === 0 && (
						<p className="py-4 text-xs text-muted-foreground">
							{t("protection.empty")}
						</p>
					)}
				</>
			)}
			{comparison && <FileComparison key={comparison.jobId} {...comparison} />}
			<SectionDivider />
			<ProtectionJobs />
			{localConfigured && activePolicy && (
				<>
					<SectionDivider />
					<h3 className="text-ui font-medium">{t("protection.retention")}</h3>
					<div className="grid gap-3 sm:grid-cols-2">
						{(["withinHours", "daily", "weekly", "monthly"] as const).map(
							(field) => (
								<label
									key={field}
									htmlFor={`backup-policy-${field}`}
									className="space-y-1 text-xs"
								>
									<span>{t(`protection.${field}`)}</span>
									<Input
										id={`backup-policy-${field}`}
										type="number"
										min={1}
										value={activePolicy[field]}
										onChange={(event) =>
											setPolicy({
												...activePolicy,
												[field]: Number(event.target.value),
											})
										}
									/>
								</label>
							),
						)}
					</div>
					<div className="flex gap-2">
						<Button
							disabled={!policy || savePolicy.isPending}
							onClick={() => savePolicy.mutate(activePolicy)}
						>
							{t("protection.save")}
						</Button>
						<Button
							variant="secondary"
							disabled={!configured || maintenance}
							onClick={() => setCleanupOpen(true)}
						>
							{t("protection.previewCleanup")}
						</Button>
					</div>
				</>
			)}
			<AppDialog
				open={creating}
				onOpenChange={setCreating}
				title={t("protection.create")}
				footer={
					<Button
						disabled={backup.isPending}
						onClick={() =>
							backup.mutate({ name, note, kind: "manual", pinned: true })
						}
					>
						{t("protection.create")}
					</Button>
				}
			>
				<div className="space-y-3">
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder={t("protection.name")}
						aria-label={t("protection.name")}
					/>
					<Input
						value={note}
						onChange={(event) => setNote(event.target.value)}
						placeholder={t("protection.note")}
						aria-label={t("protection.note")}
					/>
				</div>
			</AppDialog>
			<AppDialog
				open={editing !== null}
				onOpenChange={(open) => {
					if (!open) setEditing(null)
				}}
				title={t("protection.metadata")}
				footer={
					<Button
						disabled={!editing || metadata.isPending}
						onClick={() => {
							if (editing)
								metadata.mutate({
									repositoryId,
									pointId: editing.id,
									metadata: {
										name: editing.name,
										note: editing.note,
										kind: editing.kind,
										pinned: editing.pinned,
									},
								})
						}}
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
						/>
						<Input
							value={editing.note}
							onChange={(event) =>
								setEditing({ ...editing, note: event.target.value })
							}
							aria-label={t("protection.note")}
						/>
						<label className="flex items-center gap-2 text-xs">
							<input
								type="checkbox"
								checked={editing.pinned}
								onChange={(event) =>
									setEditing({ ...editing, pinned: event.target.checked })
								}
							/>
							{t("protection.pinned")}
						</label>
					</div>
				)}
			</AppDialog>
			<ConfirmByTypingDialog
				open={restorePlan !== null}
				onOpenChange={(open) => {
					if (!open) setRestorePlan(null)
				}}
				title={t("protection.restoreTitle")}
				description={t("protection.restoreDescription")}
				targetName={
					restorePlan?.point.name ||
					(restorePlan
						? new Date(restorePlan.point.createdAt).toLocaleString()
						: "")
				}
				expectedInput="RESTORE"
				typed={typed}
				onTypedChange={setTyped}
				prompt={
					<>
						{restorePlan?.point.name ||
							(restorePlan
								? new Date(restorePlan.point.createdAt).toLocaleString()
								: "")}
						<br />
						<strong>{t("protection.restorePrompt")}</strong>
					</>
				}
				confirmLabel={t("protection.restore")}
				pendingLabel={t("protection.loading")}
				pending={restore.isPending}
				inputTestId="full-restore-confirm"
				confirmTestId="full-restore-submit"
				onConfirm={() => {
					if (restorePlan && typed === "RESTORE")
						restore.mutate({ planId: restorePlan.id, confirmation: "RESTORE" })
				}}
			/>
			<ConfirmDialog
				open={drillPoint !== null}
				onOpenChange={(open) => {
					if (!open) setDrillPoint(null)
				}}
				title={t("protection.drill")}
				description={t("protection.drillHelp")}
				confirmLabel={t("protection.drill")}
				isPending={drill.isPending}
				onConfirm={() => {
					if (drillPoint)
						drill.mutate({
							repositoryId,
							pointId: drillPoint.id,
							full: fullDrill,
							targetId: fullDrill ? drillTarget : "local",
						})
				}}
				body={
					<div className="space-y-3">
						<label className="flex items-center gap-2 text-xs">
							<input
								type="checkbox"
								checked={fullDrill}
								onChange={(event) => setFullDrill(event.target.checked)}
							/>
							{t("protection.fullDrill")}
						</label>
						{fullDrill && (
							<div className="space-y-2 text-xs">
								{t("protection.drillDestination")}
								<DropdownSelect
									value={drillTarget}
									aria-label={t("protection.drillDestination")}
									options={(status.data?.drillTargets ?? []).map((entry) => ({
										value: entry.id,
										label: entry.path,
									}))}
									onValueChange={(value) => {
										if (value === "local" || value === "external")
											setDrillTarget(value)
									}}
								/>
							</div>
						)}
					</div>
				}
			/>
			<ConfirmDialog
				open={deletePoint !== null}
				onOpenChange={(open) => {
					if (!open) setDeletePoint(null)
				}}
				title={t("replication.remove")}
				description={
					deletePoint?.name ||
					(deletePoint ? new Date(deletePoint.createdAt).toLocaleString() : "")
				}
				confirmLabel={t("replication.remove")}
				isPending={remove.isPending}
				onConfirm={() => {
					if (deletePoint)
						remove.mutate({ repositoryId, pointId: deletePoint.id })
				}}
			/>
			<ConfirmDialog
				open={cleanupOpen}
				onOpenChange={setCleanupOpen}
				title={t("protection.cleanup")}
				description={t("protection.cleanupDescription")}
				confirmLabel={t("protection.cleanup")}
				pendingLabel={t("protection.loading")}
				isPending={cleanup.isPending}
				confirmDisabled={
					cleanupPreview.isPending ||
					cleanupPreview.isError ||
					!cleanupPreview.data?.length
				}
				onConfirm={() => cleanup.mutate({ repositoryId, prune: reclaim })}
				body={
					<>
						<p className="text-xs">
							{cleanupPreview.data?.length ?? 0} {t("protection.auto")}
						</p>
						<ul className="max-h-48 overflow-auto text-xs">
							{cleanupPreview.data?.map((point) => (
								<li key={point.id}>
									{point.name || new Date(point.createdAt).toLocaleString()}
								</li>
							))}
						</ul>
						<label className="flex items-center gap-2 text-xs">
							<input
								type="checkbox"
								checked={reclaim}
								onChange={(event) => setReclaim(event.target.checked)}
							/>
							{t("protection.reclaim")}
						</label>
					</>
				}
			/>
		</div>
	)
}
