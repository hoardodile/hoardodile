import { Eraser } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { ConfirmByTypingDialog } from "@/components/common/ConfirmByTypingDialog"
import { useConfirmDialog } from "@/components/common/useConfirmDialog"
import { DangerRow } from "@/features/settings/DangerRow"
import { clearAllUsageMutation, usageKeys } from "@/features/usage/api"
import { clearUsageBeatQueue } from "@/features/usage/beatQueue"
import { useToastMutation } from "@/hooks/useToastMutation"

/**
 * Destructive control to wipe all usage sessions from the server and the
 * local offline beat queue. Requires typed confirmation.
 */
export function ClearUsagePanel() {
	const { t } = useTranslation()
	const confirm = useConfirmDialog<true>()
	const confirmPhrase = t("me.usage.confirmPhrase")

	const clearMut = useToastMutation({
		...clearAllUsageMutation(),
		invalidate: async (qc) => {
			await clearUsageBeatQueue()
			await qc.invalidateQueries({ queryKey: usageKeys.all })
		},
		successToastKey: "me.usage.toastSuccess",
		errorToastKey: "me.usage.toastFailed",
		onSuccess: () => confirm.close(),
	})

	return (
		<>
			<DangerRow
				title={t("me.usage.rowTitle")}
				description={t("me.usage.rowDescription")}
				icon={Eraser}
				actionLabel={t("me.usage.clearAll")}
				pendingLabel={t("me.usage.clearing")}
				isPending={clearMut.isPending}
				onAction={() => confirm.open(true)}
				data-testid="clear-all-usage"
			/>

			{confirm.target !== undefined ? (
				<ConfirmByTypingDialog
					open={confirm.isOpen}
					onOpenChange={confirm.onOpenChange}
					title={t("me.usage.confirmTitle")}
					description={t("me.usage.confirmDescription")}
					targetName={confirmPhrase}
					expectedInput={confirmPhrase}
					confirmLabel={t("me.usage.confirmLabel")}
					pendingLabel={t("me.usage.clearing")}
					pending={clearMut.isPending}
					typed={confirm.typed}
					onTypedChange={confirm.setTyped}
					onConfirm={() => clearMut.mutate(undefined)}
					inputTestId="clear-usage-confirm-input"
					confirmTestId="clear-usage-confirm-submit"
				/>
			) : null}
		</>
	)
}
