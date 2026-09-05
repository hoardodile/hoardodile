import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { Input } from "@hoardodile/ui/components/input"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import type { RouterOutputs } from "@/trpc/client"
import { trpcMutation, trpcQueryOptions } from "@/trpc/factory"
import { downloadRecoveryKey, protectionStatusOptions } from "./api"

type Policy = RouterOutputs["protection"]["status"]["policy"]

export function BackupManagement({ repositoryId }: { repositoryId: string }) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const status = useQuery(protectionStatusOptions())
	const [policy, setPolicy] = useState<Policy | null>(null)
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
		<details
			className="border-t border-border pt-3"
			data-testid="backup-management"
		>
			<summary className="cursor-pointer py-2 text-ui font-medium">
				{t("protectionUx.manage")}
			</summary>
			<div className="space-y-4 py-3">
				<p className="text-xs text-secondary-foreground">
					{t("protectionUx.checkHelp")}
				</p>
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
						variant="ghost"
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
				{repositoryId === "local" && activePolicy && (
					<>
						<h3 className="text-ui font-medium">{t("protection.retention")}</h3>
						<p className="text-xs text-secondary-foreground">
							{t("protectionUx.policyHelp")}
						</p>
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
			</div>
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
		</details>
	)
}
