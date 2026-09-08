import { Button } from "@hoardodile/ui/components/button"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { Switch } from "@hoardodile/ui/components/switch"
import { Database, History, Server } from "@hoardodile/ui/icons/registry"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsSection } from "@/features/settings/SettingsSection"
import { SectionDivider } from "@/features/settings/SettingsSheet"
import { useToastMutation } from "@/hooks/useToastMutation"
import { formatBytes } from "@/lib/formatBytes"
import { trpcMutation } from "@/trpc/factory"
import {
	downloadRecoveryKey,
	protectionJobsOptions,
	protectionStatusOptions,
	recoveryPointsOptions,
	replicationStatusOptions,
} from "./api"
import { BackupManagement } from "./BackupManagement"
import { BackupPointActions } from "./BackupPointActions"
import { BackupSetupWizard } from "./BackupSetupWizard"
import { BackupStatusHeader } from "./BackupStatusHeader"
import { ProtectionJobs } from "./ProtectionJobs"
import { ReplicationPanel } from "./ReplicationPanel"
import { useSyncHealth } from "./syncHealth"

function wasKeyDownloaded(key: string | undefined) {
	try {
		return key ? localStorage.getItem(key) === "true" : false
	} catch {
		return false
	}
}

/** Skeleton shown while the protection status loads — mirrors the
    "Complete backups" section anatomy instead of a bare "Loading…". */
function BackupsSkeleton() {
	return (
		<div className="space-y-6" data-testid="backups-skeleton" aria-hidden>
			<div className="flex items-center gap-3">
				<Skeleton className="size-8 rounded-lg" />
				<div className="min-w-0 space-y-1.5">
					<Skeleton className="h-4 w-52" />
					<Skeleton className="h-3 w-72" />
				</div>
			</div>
			<div className="space-y-4">
				<div className="flex items-center gap-2">
					<Skeleton className="h-4 w-56" />
					<Skeleton className="h-4 w-24" />
				</div>
				<Skeleton className="h-5 w-48" />
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-24 w-full" />
			</div>
		</div>
	)
}

export function RecoveryPanel({
	restoreOnly = false,
}: {
	restoreOnly?: boolean
} = {}) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const status = useQuery(protectionStatusOptions())
	const health = useSyncHealth()
	const replicationStatus = useQuery(replicationStatusOptions())
	const [selectedRepository, setSelectedRepository] = useState("local")
	const [savedKey, setSavedKey] = useState<string>()
	const [wizardMode, setWizardMode] = useState<"new" | "existing" | null>(null)
	const repositories = status.data?.repositories ?? []
	const repository =
		repositories.find((repo) => repo.id === selectedRepository) ??
		repositories[0]
	const repositoryId = repository?.id ?? "local"
	const localConfigured = repositories.some((repo) => repo.id === "local")
	// The setup grid leads when there is no local backup, no received backup,
	// and the device is not already committed to a sync role (an unconfigured
	// or still-loading role counts as "no role yet").
	const needsSetup =
		!localConfigured &&
		!health.hasReceivedBackup &&
		health.role !== "send" &&
		health.role !== "receive"
	const points = useQuery({
		...recoveryPointsOptions(repositoryId),
		enabled: Boolean(repository),
	})
	// Hide the whole "Available backups" section when the selected repository
	// has no recovery points; keep it (with loading/error states) while the
	// points query is still pending or has failed.
	const showAvailableBackups =
		!points.isSuccess || (points.data?.length ?? 0) > 0
	const jobs = useQuery(protectionJobsOptions())
	const hasJobs = Boolean(jobs.data && jobs.data.length > 0)
	const maintenance = Boolean(
		status.data?.maintenance ||
			status.data?.maintenanceActive ||
			status.data?.maintenanceError,
	)
	const keyStorage = status.data
		? `hoardodile.recovery-key.${status.data.instanceId}`
		: undefined
	const keySaved = savedKey === keyStorage || wasKeyDownloaded(keyStorage)
	const invalidate = async () => {
		await qc.invalidateQueries({ queryKey: ["protection"] })
	}
	const enabled = useToastMutation({
		...trpcMutation("protection", "enabled"),
		onSuccess: invalidate,
	})
	const key = useToastMutation({
		...trpcMutation("protection", "recoveryKey"),
		onSuccess: (value) => {
			downloadRecoveryKey(value, value.repositoryId)
			if (keyStorage) {
				try {
					localStorage.setItem(keyStorage, "true")
				} catch {}
			}
			setSavedKey(keyStorage)
		},
	})
	const receiveSetup = useToastMutation({
		...trpcMutation("replication", "configure"),
		onSuccess: async () => {
			await Promise.all([
				qc.invalidateQueries({ queryKey: ["replication"] }),
				qc.invalidateQueries({ queryKey: ["sync"] }),
				invalidate(),
			])
		},
	})
	const sourceName =
		repositoryId === "local"
			? t("protectionUx.localBackups")
			: (repository?.name ?? repositoryId)
	const receiveName = replicationStatus.data?.name?.trim() || ""

	const sections: ReactNode[] = []
	if (!restoreOnly)
		sections.push(
			<SettingsSection
				key="complete-backups"
				icon={Database}
				title={t("protectionUx.protectionTitle")}
				description={t("protectionUx.description")}
				layout="stack"
				data-testid="complete-backups-section"
			>
				<div className="space-y-6">
					<BackupStatusHeader />
					<div className="space-y-4">
						<div className="text-base font-semibold text-foreground">
							{t("protection.title")}
						</div>
						{needsSetup && (
							<div className="grid gap-3">
								<button
									type="button"
									data-testid="setup-new-backup"
									className="flex w-full flex-col items-start gap-1 rounded-lg bg-secondary px-4 py-4 text-left text-foreground transition-colors hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
									onClick={() => setWizardMode("new")}
								>
									<span className="text-ui font-medium">
										{t("backupSetup.startNew")}
									</span>
									<span className="text-xs text-secondary-foreground">
										{t("backupSetup.startNewHint")}
									</span>
								</button>
								<button
									type="button"
									data-testid="setup-existing-backup"
									className="flex w-full flex-col items-start gap-1 rounded-lg bg-secondary px-4 py-4 text-left text-foreground transition-colors hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
									onClick={() => setWizardMode("existing")}
								>
									<span className="text-ui font-medium">
										{t("backupSetup.startExisting")}
									</span>
									<span className="text-xs text-secondary-foreground">
										{t("backupSetup.startExistingHint")}
									</span>
								</button>
								<button
									type="button"
									data-testid="setup-sync-receive"
									disabled={receiveSetup.isPending || !receiveName}
									className="flex w-full flex-col items-start gap-1 rounded-lg bg-secondary px-4 py-4 text-left text-foreground transition-colors hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
									onClick={() =>
										receiveSetup.mutate({
											role: "receive",
											name: receiveName,
											paused: false,
										})
									}
								>
									<span className="text-ui font-medium">
										{t("replicationUx.receive")}
									</span>
									<span className="text-xs text-secondary-foreground">
										{t("replicationUx.receiveHelp")}
									</span>
								</button>
							</div>
						)}
						{localConfigured && (
							<section
								className="space-y-3"
								aria-label={t("protectionUx.status")}
							>
								<p className="break-all text-xs">
									{t("protection.folder")}: {status.data?.backupRoot}
								</p>
								<p className="text-xs text-secondary-foreground">
									{t("protectionUx.locationHelp")}
								</p>
								<div className="flex flex-wrap items-center gap-4">
									<div className="flex items-center gap-2 text-xs">
										<Switch
											checked={status.data?.enabled ?? false}
											disabled={enabled.isPending}
											onCheckedChange={(checked) =>
												enabled.mutate({ enabled: checked })
											}
											aria-label={t("protection.automatic")}
										/>
										<span>{t("protection.automatic")}</span>
									</div>
								</div>
								{!keySaved && (
									<div
										className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-4"
										data-testid="recovery-key-notice"
									>
										<div className="min-w-0 flex-1">
											<p className="text-ui font-medium">
												{t("protectionUx.saveKey")}
											</p>
											<p className="mt-1 text-xs text-secondary-foreground">
												{t("protection.keyHelp")}
											</p>
										</div>
										<Button
											variant="secondary"
											disabled={key.isPending}
											onClick={() => key.mutate({ repositoryId: "local" })}
										>
											{t("protection.key")}
										</Button>
									</div>
								)}
							</section>
						)}
						{!needsSetup && <ReplicationPanel embedded />}
					</div>
				</div>
			</SettingsSection>,
		)
	if (repository && showAvailableBackups) {
		if (sections.length > 0) sections.push(<SectionDivider key="divider-1" />)
		sections.push(
			<SettingsSection
				key="available-backups"
				icon={Server}
				title={t("protectionUx.availableBackups")}
				layout="stack"
				data-testid="available-backups-section"
			>
				<div className="space-y-4">
					{repositories.length > 1 && (
						<div className="flex items-center justify-between gap-3">
							<span className="text-xs text-muted-foreground">
								{t("protection.repository")}
							</span>
							<DropdownSelect
								value={repositoryId}
								onValueChange={setSelectedRepository}
								options={repositories.map((repo) => ({
									value: repo.id,
									label:
										repo.id === "local"
											? t("protectionUx.localBackups")
											: repo.name,
								}))}
								aria-label={t("protection.repository")}
							/>
						</div>
					)}
					{points.error && <p role="alert">{points.error.message}</p>}
					{points.isPending && (
						<div
							className="space-y-3"
							data-testid="available-backups-skeleton"
							aria-hidden
						>
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</div>
					)}
					{points.data && points.data.length > 0 && (
						<div className="divide-y divide-border">
							{points.data
								.toSorted((a, b) => b.createdAt - a.createdAt)
								.map((point) => (
									<details
										key={repositoryId + point.id}
										data-testid={`recovery-point-${point.id}`}
									>
										<summary className="cursor-pointer py-3 text-ui">
											<span>
												{point.name ||
													new Date(point.createdAt).toLocaleString()}
											</span>
											<span className="ml-3 text-xs text-muted-foreground">
												{t(`protection.${point.kind}`)}
												{point.totalBytes !== undefined
													? ` · ${formatBytes(point.totalBytes)}`
													: ""}
												{point.pinned ? ` · ${t("protection.pinned")}` : ""}
											</span>
										</summary>
										<BackupPointActions
											point={point}
											repositoryId={repositoryId}
											source={sourceName}
											canDelete={(points.data?.length ?? 0) > 1}
											restoreOnly={restoreOnly || maintenance}
										/>
									</details>
								))}
						</div>
					)}
					{!restoreOnly && !maintenance && (
						<BackupManagement key={repositoryId} repositoryId={repositoryId} />
					)}
				</div>
			</SettingsSection>,
		)
	}
	if (!restoreOnly && hasJobs) {
		if (sections.length > 0) sections.push(<SectionDivider key="divider-2" />)
		sections.push(
			<SettingsSection
				key="recent-operations"
				icon={History}
				title={t("protection.jobs")}
				description={t("protectionUx.jobsHelp")}
				layout="stack"
				data-testid="recent-operations-section"
			>
				<ProtectionJobs showHeading={false} />
			</SettingsSection>,
		)
	}

	return (
		<div data-testid="complete-backups">
			{status.isPending ? (
				<BackupsSkeleton />
			) : (
				<>
					{status.error && <p role="alert">{status.error.message}</p>}
					{sections}
				</>
			)}
			<BackupSetupWizard
				open={wizardMode !== null}
				onOpenChange={(open) => {
					if (!open) setWizardMode(null)
				}}
				onStarted={() => setWizardMode(null)}
				mode={wizardMode ?? "new"}
			/>
		</div>
	)
}
