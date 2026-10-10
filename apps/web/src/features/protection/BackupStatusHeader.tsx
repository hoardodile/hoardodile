import { Button } from "@hoardodile/ui/components/button"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import { trpcMutation } from "@/trpc/factory"
import { protectionJobsOptions, protectionStatusOptions } from "./api"

type HeaderMode =
	| "maintenance"
	| "noBackups"
	| "backupOff"
	| "backupNow"
	| "ok"
	| "offline"
	| "running"

/** The backup verdict depends only on this device's backup state. */
export function BackupStatusHeader({
	onSetUpBackups,
}: {
	onSetUpBackups?: () => void
}) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const statusQuery = useQuery(protectionStatusOptions())
	const jobsQuery = useQuery(protectionJobsOptions())
	const status = statusQuery.data

	const invalidate = async () => {
		await qc.invalidateQueries({ queryKey: ["protection"] })
	}
	const backup = useToastMutation({
		...trpcMutation("protection", "backup"),
		onSuccess: invalidate,
	})

	if (statusQuery.isPending || statusQuery.error || !status) return null

	const localConfigured =
		status.repositories?.some((repo) => repo.id === "local") ?? false
	const enabled = Boolean(status.enabled)
	const lastBackupAt = status.lastBackupAt ?? null
	const maintenance = Boolean(
		status.maintenance || status.maintenanceActive || status.maintenanceError,
	)
	const activeBackup = jobsQuery.data?.find(
		(job) =>
			job.kind === "backup" &&
			["queued", "running", "cancelling"].includes(job.state),
	)

	let mode: HeaderMode
	if (maintenance) mode = "maintenance"
	else if (localConfigured && status.backupAvailable === false) mode = "offline"
	else if (activeBackup) mode = "running"
	else if (!localConfigured) mode = "noBackups"
	else if (!enabled) mode = "backupOff"
	else if (!lastBackupAt) mode = "backupNow"
	else mode = "ok"
	const title = {
		offline: t("backupFolders.offlineTitle"),
		maintenance: t("protection.maintenance"),
		noBackups: t("backupHealth.noBackupsTitle"),
		backupOff: t("backupHealth.automaticOffTitle"),
		backupNow: t("protectionUx.firstBackupMissing"),
		ok: t("backupHealth.protectedTitle"),
		running: t(
			lastBackupAt
				? "protectionUx.backupRunning"
				: "protectionUx.firstBackupRunning",
		),
	}[mode]

	const sub: Record<HeaderMode, string> = {
		offline: t("backupFolders.offlineHelp"),
		maintenance: status.maintenanceError
			? t("protectionUx.taskFailed")
			: t("protection.maintenanceHelp"),
		noBackups: t("backupHealth.noBackupsSub"),
		backupOff: t("backupHealth.backupOffSub"),
		backupNow: t("backupHealth.neverBackedUpSub"),
		ok: t("backupHealth.protectedSub", {
			local: new Date(lastBackupAt ?? Date.now()).toLocaleString(),
		}),
		running: t("protectionUx.keepReading"),
	}

	return (
		<div
			className="flex flex-wrap items-center justify-between gap-4"
			data-testid={`backup-health-${mode}`}
		>
			<div className="min-w-0 flex-1 basis-48">
				<div className="text-ui font-medium text-foreground">{title}</div>
				<p className="mt-1 text-xs leading-5 text-muted-foreground">
					{sub[mode]}
				</p>
			</div>
			{localConfigured ? (
				<Button
					data-testid="complete-backup-now"
					disabled={
						Boolean(activeBackup) ||
						backup.isPending ||
						maintenance ||
						status.backupAvailable === false
					}
					onClick={() =>
						backup.mutate({ name: "", note: "", kind: "manual", pinned: true })
					}
				>
					{t("backupHealth.backupNow")}
				</Button>
			) : onSetUpBackups ? (
				<Button
					data-testid="setup-new-backup"
					disabled={maintenance || Boolean(activeBackup)}
					onClick={onSetUpBackups}
				>
					{t("backupSetup.createFirst")}
				</Button>
			) : null}
		</div>
	)
}
