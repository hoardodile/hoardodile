import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { toast } from "@hoardodile/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { errorMessage } from "@/lib/errors"
import {
	pluginKeys,
	pluginUninstallMutation,
	pluginUsageCountQueryOptions,
} from "./pluginApi"

/**
 * Uninstall confirmation for a plugin row: a destructive dialog with a
 * live usage count, then permanently removes the plugin (disk directory +
 * settings row). Resources bound to it keep working through the builtin
 * fallback and revert automatically once the plugin is reinstalled.
 * Shared by the plugins page's More menu and the marketplace detail
 * dialog's uninstall action.
 */
export function PluginUninstallDialog(props: {
	readonly pluginId: string
	readonly pluginName: string
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const usageQuery = useQuery({
		...pluginUsageCountQueryOptions(props.pluginId),
		enabled: props.open,
	})
	const uninstallMut = useMutation({
		...pluginUninstallMutation(),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: pluginKeys.all })
			toast.add({
				title: t("plugins.uninstallSuccess", { name: props.pluginName }),
				type: "success",
			})
		},
		onError: (err) => {
			toast.add({
				title: errorMessage(err, t("common.error")),
				type: "error",
			})
		},
	})
	const usageCount = usageQuery.data ?? 0

	return (
		<ConfirmDialog
			open={props.open}
			onOpenChange={props.onOpenChange}
			title={t("plugins.uninstallConfirmTitle", { name: props.pluginName })}
			description={
				usageCount > 0
					? t("plugins.uninstallConfirmDescription", {
							name: props.pluginName,
							count: usageCount,
						})
					: t("plugins.uninstallConfirmNoUsage", {
							name: props.pluginName,
						})
			}
			confirmLabel={t("plugins.uninstall")}
			pendingLabel={t("common.working")}
			isPending={uninstallMut.isPending}
			destructive
			onConfirm={() => uninstallMut.mutate({ id: props.pluginId })}
		/>
	)
}
