import { Button } from "@hoardodile/ui/components/button"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import { formatBytes } from "@/lib/formatBytes"
import { trpcMutation } from "@/trpc/factory"
import {
	downloadRecoveryKey,
	protectionJobsOptions,
	protectionStatusOptions,
	recoveryPointsOptions,
} from "./api"
import { BackupManagement } from "./BackupManagement"
import { BackupPointActions } from "./BackupPointActions"
import { BackupSetup } from "./BackupSetup"
import { ProtectionJobs } from "./ProtectionJobs"

function wasKeyDownloaded(key: string | undefined) {
	try {
		return key ? localStorage.getItem(key) === "true" : false
	} catch {
		return false
	}
}

export function RecoveryPanel({
	restoreOnly = false,
}: {
	restoreOnly?: boolean
} = {}) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const status = useQuery(protectionStatusOptions())
	const jobs = useQuery(protectionJobsOptions())
	const [selectedRepository, setSelectedRepository] = useState("local")
	const [savedKey, setSavedKey] = useState<string>()
	const repositories = status.data?.repositories ?? []
	const repository =
		repositories.find((repo) => repo.id === selectedRepository) ??
		repositories[0]
	const repositoryId = repository?.id ?? "local"
	const localConfigured = repositories.some((repo) => repo.id === "local")
	const points = useQuery({
		...recoveryPointsOptions(repositoryId),
		enabled: Boolean(repository),
	})
	const localPoints = useQuery({
		...recoveryPointsOptions("local"),
		enabled: localConfigured,
	})
	const latest = localPoints.data?.toSorted(
		(a, b) => b.createdAt - a.createdAt,
	)[0]
	const maintenance = Boolean(
		status.data?.maintenance ||
			status.data?.maintenanceActive ||
			status.data?.maintenanceError,
	)
	const activeBackup = jobs.data?.find(
		(job) =>
			job.kind === "backup" &&
			["queued", "running", "cancelling"].includes(job.state),
	)
	const keyStorage = status.data
		? `hoardodile.recovery-key.${status.data.instanceId}`
		: undefined
	const keySaved = savedKey === keyStorage || wasKeyDownloaded(keyStorage)
	const invalidate = async () => {
		await qc.invalidateQueries({ queryKey: ["protection"] })
	}
	const backup = useToastMutation({
		...trpcMutation("protection", "backup"),
		onSuccess: invalidate,
	})
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
	const sourceName =
		repositoryId === "local"
			? t("protectionUx.localBackups")
			: (repository?.name ?? repositoryId)
	return (
		<div className="space-y-5" data-testid="complete-backups">
			{!restoreOnly && (
				<header className="space-y-1">
					<h2 className="text-lg font-medium">{t("protection.title")}</h2>
					<p className="text-xs text-secondary-foreground">
						{t("protectionUx.description")}
					</p>
				</header>
			)}
			{status.isPending && <p>{t("common.loading")}</p>}
			{status.error && <p role="alert">{status.error.message}</p>}
			{status.data && !localConfigured && !maintenance && !restoreOnly && (
				<BackupSetup
					backupRoot={status.data.backupRoot}
					repositoryPath={status.data.localRepositoryPath}
					onStarted={() => setSelectedRepository("local")}
				/>
			)}
			{localConfigured && !restoreOnly && (
				<section className="space-y-3" aria-label={t("protectionUx.status")}>
					<p className="text-ui font-medium" data-testid="backup-summary">
						{activeBackup
							? t(
									latest
										? "protectionUx.backupRunning"
										: "protectionUx.firstBackupRunning",
								)
							: latest
								? t("protectionUx.backupCompleted", {
										time: new Date(latest.createdAt).toLocaleString(),
									})
								: t("protectionUx.firstBackupMissing")}
					</p>
					{latest && activeBackup && (
						<p className="text-xs text-muted-foreground">
							{t("protectionUx.backupCompleted", {
								time: new Date(latest.createdAt).toLocaleString(),
							})}
						</p>
					)}
					<p className="break-all text-xs">
						{t("protection.folder")}: {status.data?.backupRoot}
					</p>
					<p className="text-xs text-secondary-foreground">
						{t("protectionUx.locationHelp")}
					</p>
					<div className="flex flex-wrap items-center gap-4">
						<Button
							data-testid="complete-backup-now"
							disabled={
								backup.isPending || Boolean(activeBackup) || maintenance
							}
							onClick={() =>
								backup.mutate({
									name: "",
									note: "",
									kind: "manual",
									pinned: true,
								})
							}
						>
							{t("protection.create")}
						</Button>
						<label className="flex items-center gap-2 text-xs">
							<input
								type="checkbox"
								checked={status.data?.enabled ?? false}
								disabled={enabled.isPending}
								onChange={(event) =>
									enabled.mutate({ enabled: event.target.checked })
								}
							/>
							{t("protection.automatic")}
						</label>
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
			{!restoreOnly && <ProtectionJobs activeOnly />}
			{repository && (
				<section
					className="space-y-3"
					aria-label={t("protectionUx.availableBackups")}
				>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h3 className="text-ui font-medium">
							{t("protectionUx.availableBackups")}
						</h3>
						{repositories.length > 1 && (
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
						)}
					</div>
					{points.error && <p role="alert">{points.error.message}</p>}
					{points.isPending && <p className="text-xs">{t("common.loading")}</p>}
					{points.data?.length === 0 && (
						<p className="text-xs text-secondary-foreground">
							{t("protection.empty")}
						</p>
					)}
					<div className="divide-y divide-border">
						{points.data
							?.toSorted((a, b) => b.createdAt - a.createdAt)
							.map((point) => (
								<details
									key={repositoryId + point.id}
									data-testid={`recovery-point-${point.id}`}
								>
									<summary className="cursor-pointer py-3 text-ui">
										<span>
											{point.name || new Date(point.createdAt).toLocaleString()}
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
				</section>
			)}
			{repository && !restoreOnly && !maintenance && (
				<BackupManagement key={repositoryId} repositoryId={repositoryId} />
			)}
			{!restoreOnly && (
				<details className="border-t border-border pt-3">
					<summary className="cursor-pointer py-2 text-ui">
						{t("protection.jobs")}
					</summary>
					<ProtectionJobs />
				</details>
			)}
		</div>
	)
}
