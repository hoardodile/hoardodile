import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Input } from "@hoardodile/ui/components/input"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import { trpcMutation } from "@/trpc/factory"
import { protectionStatusOptions, type RecoveryPoint } from "./api"
import { FileComparison } from "./FileComparison"
import { RestoreBackupButton } from "./RestoreBackupButton"

export function BackupPointActions({
	point,
	repositoryId,
	source,
	canDelete,
	restoreOnly = false,
}: {
	point: RecoveryPoint
	repositoryId: string
	source: string
	canDelete: boolean
	restoreOnly?: boolean
}) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const status = useQuery(protectionStatusOptions())
	const [editing, setEditing] = useState<RecoveryPoint | null>(null)
	const [drillPoint, setDrillPoint] = useState<RecoveryPoint | null>(null)
	const [fullDrill, setFullDrill] = useState(false)
	const [drillTarget, setDrillTarget] = useState<"local" | "external">("local")
	const [deletePoint, setDeletePoint] = useState<RecoveryPoint | null>(null)
	const [comparison, setComparison] = useState<{
		jobId: string
		pointId: string
		repositoryId: string
	} | null>(null)
	const invalidate = async () => {
		await qc.invalidateQueries({ queryKey: ["protection"] })
	}
	const metadata = useToastMutation({
		...trpcMutation("protection", "metadata"),
		onSuccess: async () => {
			setEditing(null)
			await invalidate()
		},
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
		onSuccess: async (job) => {
			setComparison({ jobId: job.id, pointId: point.id, repositoryId })
			await invalidate()
		},
	})
	return (
		<div className="space-y-3 py-3">
			{point.note && <p className="text-xs">{point.note}</p>}
			<RestoreBackupButton
				repositoryId={repositoryId}
				pointId={point.id}
				source={source}
			/>
			{!restoreOnly && (
				<details className="text-xs">
					<summary className="cursor-pointer py-2">
						{t("protectionUx.pointTools")}
					</summary>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="ghost"
							disabled={compare.isPending}
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
							onClick={() => {
								setDrillPoint(point)
								setFullDrill(false)
							}}
						>
							{t("protection.drill")}
						</Button>
						<Button
							variant="ghost"
							disabled={!canDelete}
							onClick={() => setDeletePoint(point)}
						>
							{t("replication.remove")}
						</Button>
					</div>
					<p className="mt-2 text-muted-foreground">
						{t("protection.drillHelp")}
					</p>
				</details>
			)}
			{comparison && <FileComparison key={comparison.jobId} {...comparison} />}
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
		</div>
	)
}
