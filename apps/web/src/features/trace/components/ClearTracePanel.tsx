import { ConfirmByTypingDialog } from "@hoardodile/ui/components/confirm-by-typing-dialog"
import { Eraser } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { useConfirmDialog } from "@/components/common/useConfirmDialog"
import { DangerRow } from "@/features/settings/DangerRow"
import { clearAllTraceMutation, traceKeys } from "@/features/trace/api"
import { useToastMutation } from "@/hooks/useToastMutation"

/**
 * Destructive control to wipe the user-footprint event log. Requires
 * typed confirmation.
 */
export function ClearTracePanel() {
	const { t } = useTranslation()
	const confirm = useConfirmDialog<true>()
	const confirmPhrase = t("me.trace.confirmPhrase")

	const clearMut = useToastMutation({
		...clearAllTraceMutation(),
		invalidate: async (qc) => {
			await qc.invalidateQueries({ queryKey: traceKeys.all })
		},
		successToastKey: "me.trace.toastSuccess",
		errorToastKey: "me.trace.toastFailed",
		onSuccess: () => confirm.close(),
	})

	return (
		<>
			<DangerRow
				title={t("me.trace.rowTitle")}
				description={t("me.trace.description")}
				icon={Eraser}
				actionLabel={t("me.trace.clearAll")}
				pendingLabel={t("me.trace.clearing")}
				isPending={clearMut.isPending}
				onAction={() => confirm.open(true)}
				data-testid="clear-all-trace"
			/>

			{confirm.target !== undefined ? (
				<ConfirmByTypingDialog
					open={confirm.isOpen}
					onOpenChange={confirm.onOpenChange}
					title={t("me.trace.confirmTitle")}
					description={t("me.trace.confirmDescription")}
					targetName={confirmPhrase}
					expectedInput={confirmPhrase}
					confirmLabel={t("me.trace.confirmLabel")}
					pendingLabel={t("me.trace.clearing")}
					pending={clearMut.isPending}
					typed={confirm.typed}
					onTypedChange={confirm.setTyped}
					onConfirm={() => clearMut.mutate(undefined)}
					inputTestId="clear-trace-confirm-input"
					confirmTestId="clear-trace-confirm-submit"
				/>
			) : null}
		</>
	)
}
