import { Button } from "@hoardodile/ui/components/button"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import {
	Empty,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@hoardodile/ui/components/empty"
import { Icon } from "@hoardodile/ui/components/icon"
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
} from "./api"
import { BackupManagement } from "./BackupManagement"
import { BackupPointActions } from "./BackupPointActions"
import { BackupSetupWizard } from "./BackupSetupWizard"
import { BackupStatusHeader } from "./BackupStatusHeader"
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
	const [selectedRepository, setSelectedRepository] = useState("local")
	const [savedKey, setSavedKey] = useState<string>()
	const [wizardMode, setWizardMode] = useState<"new" | "existing" | null>(null)
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
	const sourceName =
		repositoryId === "local"
			? t("protectionUx.localBackups")
			: (repository?.name ?? repositoryId)

	const sections: ReactNode[] = []
	if (!restoreOnly)
		sections.push(
			<SettingsSection
				key="complete-backups"
				icon={Database}
				title={t("protection.title")}
				description={t("protectionUx.description")}
				layout="stack"
				data-testid="complete-backups-section"
			>
				<div className="space-y-5">
					{localConfigured ? (
						<BackupStatusHeader />
					) : (
						<section className="space-y-4" aria-label={t("protectionUx.setup")}>
							<div>
								<p className="text-ui font-medium text-foreground">
									{t("backupHealth.noBackupsTitle")}
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									{t("backupHealth.noBackupsSub")}
								</p>
							</div>
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
							</div>
						</section>
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
				</div>
			</SettingsSection>,
		)
	if (repository) {
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
					{points.isPending && <p className="text-xs">{t("common.loading")}</p>}
					{points.data?.length === 0 && (
						<Empty className="py-8">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<Icon icon={Server} className="size-6" />
								</EmptyMedia>
								<EmptyTitle>{t("protection.empty")}</EmptyTitle>
							</EmptyHeader>
						</Empty>
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
			{status.isPending && <p>{t("common.loading")}</p>}
			{status.error && <p role="alert">{status.error.message}</p>}
			{sections}
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
