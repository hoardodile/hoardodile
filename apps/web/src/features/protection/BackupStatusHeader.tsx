import { Button } from "@hoardodile/ui/components/button"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import { trpcMutation } from "@/trpc/factory"
import { protectionJobsOptions, protectionStatusOptions } from "./api"
import { useSyncHealth } from "./syncHealth"

type HeaderMode =
	| "maintenance"
	| "noBackups"
	| "backupOff"
	| "backupNow"
	| "receiver"
	| "syncUnconfigured"
	| "syncDue"
	| "ok"

/**
 * Backup-sync health verdict: the single "is my data safe?" answer that
 * leads the "Backups" section. It derives one state from the existing
 * protection / replication / sync queries (no new backend), shows a title
 * and description on the left with at most one primary action on the right.
 * The persistent shell indicator (`AppShell.BrandSyncStatus`) stays the
 * global echo; this is the expanded, in-page form.
 */
export function BackupStatusHeader({
	onSetUpBackups,
}: {
	onSetUpBackups?: () => void
}) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const statusQuery = useQuery(protectionStatusOptions())
	const jobsQuery = useQuery(protectionJobsOptions())
	const health = useSyncHealth()
	const status = statusQuery.data

	const invalidate = async () => {
		await Promise.all([
			qc.invalidateQueries({ queryKey: ["protection"] }),
			qc.invalidateQueries({ queryKey: ["replication"] }),
			qc.invalidateQueries({ queryKey: ["sync"] }),
		])
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

	// State priority: a library restore overrides everything; an unsafe backup
	// beats any sync need; only a healthy backup reaches the sync checks. A
	// receive-role device that already holds a backup from its source needs no
	// separate local backup, so the local-backup nudges fold into `receiver`.
	let mode: HeaderMode
	if (maintenance) mode = "maintenance"
	else if (!localConfigured) mode = "noBackups"
	else if (!enabled) mode = "backupOff"
	else if (!lastBackupAt) mode = "backupNow"
	else if (health.count === 0) mode = "syncUnconfigured"
	else if (health.dueCount > 0 || health.paused) mode = "syncDue"
	else mode = "ok"
	if (
		health.hasReceivedBackup &&
		(mode === "noBackups" || mode === "backupOff" || mode === "backupNow")
	)
		mode = "receiver"

	function scrollToSync() {
		document
			.querySelector('[data-testid="backup-sync"]')
			?.scrollIntoView({ behavior: "smooth", block: "start" })
	}

	const remoteAt = health.connected.reduce(
		(max, entry) => Math.max(max, entry.receivedAt ?? 0),
		0,
	)

	const title = {
		maintenance: t("protection.maintenance"),
		noBackups: t("backupHealth.noBackupsTitle"),
		backupOff: t("backupHealth.backupNeedsTitle"),
		backupNow: t("backupHealth.backupNeedsTitle"),
		receiver: t("backupHealth.receiverTitle"),
		syncUnconfigured: t("backupHealth.syncUnconfiguredTitle"),
		syncDue: t("backupHealth.syncDueTitle"),
		ok: t("backupHealth.protectedTitle"),
	}[mode]

	const sub: Record<HeaderMode, string> = {
		maintenance: status.maintenanceError
			? t("protectionUx.taskFailed")
			: t("protection.maintenanceHelp"),
		noBackups: t("backupHealth.noBackupsSub"),
		backupOff: t("backupHealth.backupOffSub"),
		backupNow: t("backupHealth.neverBackedUpSub"),
		receiver: t("backupHealth.receiverSub"),
		syncUnconfigured: t("backupHealth.syncUnconfiguredSub"),
		syncDue: t("backupHealth.syncDueSub"),
		ok: t("backupHealth.protectedSub", {
			local: new Date(lastBackupAt ?? Date.now()).toLocaleString(),
			remote: remoteAt
				? new Date(remoteAt).toLocaleString()
				: t("protection.never"),
		}),
	}

	const action: Record<HeaderMode, ReactNode> = {
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
		receiver: null,
		syncUnconfigured: (
			<Button onClick={scrollToSync}>
				{t("backupHealth.syncUnconfiguredAction")}
			</Button>
		),
		syncDue: (
			<Button onClick={scrollToSync}>{t("backupHealth.syncDueAction")}</Button>
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
