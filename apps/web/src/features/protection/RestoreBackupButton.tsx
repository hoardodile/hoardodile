import { Button } from "@hoardodile/ui/components/button"
import { ConfirmByTypingDialog } from "@hoardodile/ui/components/confirm-by-typing-dialog"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import type { RouterOutputs } from "@/trpc/client"
import { trpcMutation } from "@/trpc/factory"

type RestorePlan = RouterOutputs["protection"]["prepareRestore"]

/** Keep the approved point bound to its plan even when newer backups arrive. */
export function RestoreBackupButton({
	repositoryId,
	pointId,
	source,
	received = false,
}: {
	repositoryId: string
	pointId: string
	source: string
	received?: boolean
}) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const [plan, setPlan] = useState<RestorePlan | null>(null)
	const [typed, setTyped] = useState("")
	const prepare = useToastMutation({
		...trpcMutation("protection", "prepareRestore"),
		onSuccess: (value) => {
			setPlan(value)
			setTyped("")
		},
	})
	const restore = useToastMutation({
		...trpcMutation("protection", "restore"),
		onSuccess: async () => {
			setPlan(null)
			await Promise.all([
				qc.invalidateQueries({ queryKey: ["protection"] }),
				qc.invalidateQueries({ queryKey: ["library-maintenance"] }),
			])
		},
	})
	return (
		<>
			<Button
				variant="secondary"
				disabled={prepare.isPending}
				onClick={() => prepare.mutate({ repositoryId, pointId })}
			>
				{prepare.isPending
					? t("protectionUx.preparingRestore")
					: received
						? t("replicationUx.useBackup")
						: t("protection.restore")}
			</Button>
			<ConfirmByTypingDialog
				open={plan !== null}
				onOpenChange={(open) => {
					if (!open) setPlan(null)
				}}
				title={t("protection.restoreTitle")}
				description={t("protection.restoreDescription")}
				targetName={
					plan?.point.name ||
					(plan ? new Date(plan.point.createdAt).toLocaleString() : "")
				}
				expectedInput="RESTORE"
				typed={typed}
				onTypedChange={setTyped}
				prompt={
					<div className="space-y-2">
						<p>{t("protectionUx.restoreSource", { source })}</p>
						{plan && (
							<p>
								{plan.point.name ||
									new Date(plan.point.createdAt).toLocaleString()}{" "}
								· {new Date(plan.point.createdAt).toLocaleString()}
							</p>
						)}
						<p>{t("protectionUx.restoreKeepsHost")}</p>
						<strong>{t("protection.restorePrompt")}</strong>
					</div>
				}
				confirmLabel={t("protection.restore")}
				pendingLabel={t("protection.loading")}
				pending={restore.isPending}
				inputTestId="full-restore-confirm"
				confirmTestId="full-restore-submit"
				onConfirm={() => {
					if (plan && typed === "RESTORE")
						restore.mutate({ planId: plan.id, confirmation: "RESTORE" })
				}}
			/>
		</>
	)
}
