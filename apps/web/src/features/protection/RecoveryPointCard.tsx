import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Icon } from "@hoardodile/ui/components/icon"
import { IconTile } from "@hoardodile/ui/components/icon-tile"
import { Input } from "@hoardodile/ui/components/input"
import { MetaChip } from "@hoardodile/ui/components/meta-chip"
import {
	CheckCircle,
	ClockCircle,
	Database,
	Eye,
	MenuDots,
	Pin,
	Refresh,
	TrashBinMinimalistic,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import { formatBytes } from "@/lib/formatBytes"
import { trpcMutation } from "@/trpc/factory"
import { protectionStatusOptions, type RecoveryPoint } from "./api"
import { FileComparison } from "./FileComparison"
import { RestoreBackupButton } from "./RestoreBackupButton"

/**
 * One recovery point as a standard card — the plugin card/row anatomy
 * (icon tile, name, meta line, chips and actions in one bordered box)
 * instead of a disclosure triangle. The card is the whole interaction:
 * restore sits in the footer, the secondary operations live behind a
 * More menu, and every menu entry opens its own top-level surface.
 */
export function RecoveryPointCard({
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
	const timestamp = new Date(point.createdAt).toLocaleString()
	const title = point.name || timestamp
	const meta = [
		point.name ? timestamp : undefined,
		point.totalBytes === undefined ? undefined : formatBytes(point.totalBytes),
	]
		.filter(Boolean)
		.join(" · ")
	// A file comparison is a wide, dense list — the compared card spans the
	// whole grid row rather than squeezing the list into one cell.
	const expanded = comparison !== null
	return (
		<div
			className={cn(
				"relative flex flex-col gap-2.5 overflow-hidden rounded-xl border border-border p-4 transition-colors hover:bg-accent/40",
				expanded && "col-span-full",
			)}
			data-testid={`recovery-point-${point.id}`}
		>
			<div className="flex items-center gap-2.5">
				<IconTile
					icon={
						point.pinned
							? Pin
							: point.kind === "manual"
								? Database
								: ClockCircle
					}
				/>
				<div className="min-w-0 flex-1">
					<span className="block truncate text-ui font-medium" title={title}>
						{title}
					</span>
					{meta !== "" && (
						<span className="block truncate font-mono text-tiny text-muted-foreground">
							{meta}
						</span>
					)}
				</div>
				{!restoreOnly && (
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									className="relative size-7"
									aria-label={t("protectionUx.pointTools")}
									data-testid={`recovery-point-menu-${point.id}`}
								>
									<Icon icon={MenuDots} size="sm" />
								</Button>
							}
						/>
						<DropdownMenuContent align="end" className="w-44">
							<DropdownMenuItem
								disabled={compare.isPending}
								onClick={() =>
									compare.mutate({ repositoryId, pointId: point.id })
								}
							>
								<Icon icon={Refresh} />
								{t("protection.compare")}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setEditing(point)}>
								<Icon icon={Eye} />
								{t("protection.metadata")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => {
									setDrillPoint(point)
									setFullDrill(false)
								}}
							>
								<Icon icon={CheckCircle} />
								{t("protection.drill")}
							</DropdownMenuItem>
							<DropdownMenuItem
								variant="destructive"
								disabled={!canDelete}
								onClick={() => setDeletePoint(point)}
							>
								<Icon icon={TrashBinMinimalistic} />
								{t("replication.remove")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>
			{point.note && (
				<p className="line-clamp-2 text-xs text-muted-foreground">
					{point.note}
				</p>
			)}
			<div className="flex min-w-0 items-center gap-1.5">
				<MetaChip tone="muted">{t(`protection.${point.kind}`)}</MetaChip>
				{point.pinned && (
					<MetaChip tone="bordered">{t("protection.pinned")}</MetaChip>
				)}
				<div className="ml-auto flex shrink-0 items-center gap-2">
					<RestoreBackupButton
						repositoryId={repositoryId}
						pointId={point.id}
						source={source}
						size="sm"
					/>
				</div>
			</div>
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
