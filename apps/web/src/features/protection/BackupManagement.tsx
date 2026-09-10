import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { Input } from "@hoardodile/ui/components/input"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import type { RouterOutputs } from "@/trpc/client"
import { trpcMutation, trpcQueryOptions } from "@/trpc/factory"
import { downloadRecoveryKey, protectionStatusOptions } from "./api"

type Policy = RouterOutputs["protection"]["status"]["policy"]

/**
 * Advanced backup upkeep — retention, repository checks and cleanup.
 *
 * Each entry is a settings row whose button opens exactly one surface
 * (two dialogs and one destructive confirmation), so the page carries no
 * disclosure triangles and no dialog ever opens inside another.
 */
export function BackupManagement({ repositoryId }: { repositoryId: string }) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const status = useQuery(protectionStatusOptions())
	const [policy, setPolicy] = useState<Policy | null>(null)
	const [retentionOpen, setRetentionOpen] = useState(false)
	const [checksOpen, setChecksOpen] = useState(false)
	const [cleanupOpen, setCleanupOpen] = useState(false)
	const [reclaim, setReclaim] = useState(false)
	const configured =
		status.data?.repositories.some((repo) => repo.id === repositoryId) ?? false
	const maintenance = Boolean(
		status.data?.maintenance ||
			status.data?.maintenanceActive ||
			status.data?.maintenanceError,
	)
	const activePolicy = policy ?? status.data?.policy
	const local = repositoryId === "local" && activePolicy !== undefined
	const invalidate = async () => {
		await qc.invalidateQueries({ queryKey: ["protection"] })
	}
	const check = useToastMutation({
		...trpcMutation("protection", "check"),
		onSuccess: invalidate,
	})
	const key = useToastMutation({
		...trpcMutation("protection", "recoveryKey"),
		onSuccess: (value) => downloadRecoveryKey(value, value.repositoryId),
	})
	const savePolicy = useToastMutation({
		...trpcMutation("protection", "policy"),
		onSuccess: async () => {
			setPolicy(null)
			setRetentionOpen(false)
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
	const lastCheck = status.data?.repositories.find(
		(repo) => repo.id === repositoryId,
	)?.lastContentCheckAt
	return (
		<section
			className="space-y-4 border-t border-border pt-4"
			data-testid="backup-management"
		>
			{local && activePolicy && (
				<ActionRow
					title={t("protection.retention")}
					description={t("protectionUx.policyHelp")}
					actionLabel={t("common.edit")}
					onAction={() => setRetentionOpen(true)}
					testId="backup-retention"
				/>
			)}
			<ActionRow
				title={t("protection.check")}
				description={t("protectionUx.checkHelp")}
				actionLabel={t("protectionUx.open")}
				onAction={() => setChecksOpen(true)}
				testId="backup-checks"
			/>
			{local && (
				<ActionRow
					title={t("protection.cleanup")}
					description={t("protection.cleanupDescription")}
					actionLabel={t("protection.previewCleanup")}
					onAction={() => setCleanupOpen(true)}
					disabled={!configured || maintenance}
					testId="backup-cleanup"
				/>
			)}
			{local && activePolicy && (
				<AppDialog
					open={retentionOpen}
					onOpenChange={setRetentionOpen}
					title={t("protection.retention")}
					description={t("protectionUx.policyHelp")}
					footer={
						<Button
							disabled={!policy || savePolicy.isPending}
							onClick={() => {
								if (activePolicy) savePolicy.mutate(activePolicy)
							}}
						>
							{t("protection.save")}
						</Button>
					}
				>
					<label
						htmlFor="backup-policy-automatic"
						className="block space-y-1 text-xs"
					>
						<span className="text-ui">{t("protection.keepAutomatic")}</span>
						<Input
							id="backup-policy-automatic"
							type="number"
							min={1}
							max={365}
							value={activePolicy.automatic}
							onChange={(event) =>
								setPolicy({ automatic: Number(event.target.value) })
							}
						/>
					</label>
				</AppDialog>
			)}
			<AppDialog
				open={checksOpen}
				onOpenChange={setChecksOpen}
				title={t("protection.check")}
				description={t("protectionUx.checkHelp")}
				size="lg"
			>
				<div className="space-y-4">
					<div className="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							disabled={check.isPending || !configured}
							onClick={() => check.mutate({ repositoryId, readData: false })}
						>
							{t("protection.check")}
						</Button>
						<Button
							variant="secondary"
							disabled={check.isPending || !configured}
							onClick={() => check.mutate({ repositoryId, readData: true })}
						>
							{t("protection.checkFull")}
						</Button>
						<Button
							variant="secondary"
							disabled={key.isPending || !configured}
							onClick={() => key.mutate({ repositoryId })}
						>
							{t("protection.key")}
						</Button>
					</div>
					<p className="text-xs text-muted-foreground">
						{t("protection.lastCheck")}:{" "}
						{lastCheck
							? new Date(lastCheck).toLocaleString()
							: t("protection.never")}
					</p>
				</div>
			</AppDialog>
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
		</section>
	)
}

/** Title + muted description on the left, one secondary action on the right. */
function ActionRow(props: {
	readonly title: ReactNode
	readonly description: ReactNode
	readonly actionLabel: string
	readonly onAction: () => void
	readonly disabled?: boolean
	readonly testId: string
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<div className="min-w-0">
				<div className="text-ui font-semibold text-foreground">
					{props.title}
				</div>
				<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
					{props.description}
				</p>
			</div>
			<Button
				variant="secondary"
				size="sm"
				className="shrink-0"
				disabled={props.disabled}
				onClick={props.onAction}
				data-testid={props.testId}
			>
				{props.actionLabel}
			</Button>
		</div>
	)
}
