import { resolveSystemLanguage } from "@hoardodile/i18n/core"
import { Button } from "@hoardodile/ui/components/button"
import { ConfirmByTypingDialog } from "@hoardodile/ui/components/confirm-by-typing-dialog"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import { isHoardodileDesktop } from "@/lib/desktop"
import type { RouterOutputs } from "@/trpc/client"
import { trpcMutation } from "@/trpc/factory"

type RestorePlan = RouterOutputs["protection"]["prepareRestore"]

/** Keep the approved point bound to its plan even when newer backups arrive. */
export function RestoreBackupButton({
	repositoryId,
	pointId,
	source,
	size = "default",
}: {
	repositoryId: string
	pointId: string
	source: string
	/** Card footers use the compact `sm` tier. */
	size?: "sm" | "default"
}) {
	const { t, i18n } = useTranslation()
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
				size={size}
				disabled={prepare.isPending}
				onClick={() =>
					prepare.mutate({
						repositoryId,
						pointId,
						...(isHoardodileDesktop()
							? { language: resolveSystemLanguage(i18n.resolvedLanguage) }
							: {}),
					})
				}
			>
				{prepare.isPending
					? t("protectionUx.preparingRestore")
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
				expectedInput={plan?.confirmationPhrase ?? "RESTORE"}
				typed={typed}
				onTypedChange={setTyped}
				prompt={
					<div className="space-y-2">
						<p className="break-all">
							{t("protectionUx.restoreSource", {
								source: plan?.sourcePath ?? source,
							})}
						</p>
						{plan?.targetPath && (
							<p className="break-all">
								{t("backupFolders.restoreTarget", { path: plan.targetPath })}
							</p>
						)}
						{plan && (
							<p>
								{plan.point.name ||
									new Date(plan.point.createdAt).toLocaleString()}{" "}
								· {new Date(plan.point.createdAt).toLocaleString()}
							</p>
						)}
						<p>{t("protectionUx.restoreKeepsHost")}</p>
						<strong>
							{t("backupFolders.confirmRestore", {
								phrase: plan?.confirmationPhrase ?? "RESTORE",
							})}
						</strong>
					</div>
				}
				confirmLabel={t("protection.restore")}
				pendingLabel={t("protection.loading")}
				pending={restore.isPending}
				inputTestId="full-restore-confirm"
				confirmTestId="full-restore-submit"
				onConfirm={() => {
					if (plan && typed === (plan.confirmationPhrase ?? "RESTORE"))
						restore.mutate({ planId: plan.id, confirmation: typed })
				}}
			/>
		</>
	)
}
