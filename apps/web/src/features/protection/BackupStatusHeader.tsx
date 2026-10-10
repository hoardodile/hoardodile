import { Button } from "@hoardodile/ui/components/button"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
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
	const enable = useToastMutation({
		...trpcMutation("protection", "enabled"),
		onSuccess: invalidate,
	})
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
	else if (!localConfigured) mode = "noBackups"
	else if (!enabled) mode = "backupOff"
	else if (!lastBackupAt) mode = "backupNow"
	else mode = "ok"
	const title = {
		offline: t("backupFolders.offlineTitle"),
		maintenance: t("protection.maintenance"),
		noBackups: t("backupHealth.noBackupsTitle"),
		backupOff: t("backupHealth.backupNeedsTitle"),
		backupNow: t("backupHealth.backupNeedsTitle"),
		ok: t("backupHealth.protectedTitle"),
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
	}

	const action: Record<HeaderMode, ReactNode> = {
		offline: null,
		maintenance: null,
		noBackups: onSetUpBackups ? (
			<Button onClick={onSetUpBackups}>
				{t("backupHealth.noBackupsAction")}
			</Button>
		) : null,
		backupOff: (
			<Button
				disabled={enable.isPending || maintenance}
				onClick={() => enable.mutate({ enabled: true })}
			>
				{t("backupHealth.turnOnAutomatic")}
			</Button>
		),
		backupNow: (
			<Button
				data-testid="complete-backup-now"
				disabled={Boolean(activeBackup) || backup.isPending || maintenance}
				onClick={() =>
					backup.mutate({ name: "", note: "", kind: "manual", pinned: true })
				}
			>
				{t("backupHealth.backupNow")}
			</Button>
		),
		ok: null,
	}

	return (
		<div
			className="flex flex-wrap items-center justify-between gap-4"
			data-testid={`backup-health-${mode}`}
		>
			<div className="min-w-0 flex-1">
				<div className="text-ui font-medium text-foreground">{title}</div>
				<p className="mt-1 text-xs leading-5 text-muted-foreground">
					{sub[mode]}
				</p>
				{activeBackup && mode === "ok" && (
					<p className="mt-1 text-xs leading-5 text-secondary-foreground">
						{t("protectionUx.keepReading")}
					</p>
				)}
			</div>
			{action[mode]}
		</div>
	)
}
