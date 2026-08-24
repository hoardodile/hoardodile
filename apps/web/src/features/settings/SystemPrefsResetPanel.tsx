import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { Icon } from "@hoardodile/ui/components/icon"
import { Restart } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { useConfirmDialog } from "@/components/common/useConfirmDialog"
import { pushPrefsChanged } from "@/features/plugin/iframe/pushes"
import { systemPrefRemoveAllMutation } from "@/features/plugin/pluginApi"
import {
	hydrateSystemPrefs,
	invalidateSystemPrefsHydration,
} from "@/features/prefs/prefSyncHydrator"
import { useToastMutation } from "@/hooks/useToastMutation"
import { broadcastPrefSyncDelete } from "@/lib/prefSync"
import { prefSyncStore } from "@/lib/prefSyncStore"

/**
 * "Restore system defaults" — wipes every system preference (theme,
 * language, font, date format, …) server-side and drops the synced
 * client mirrors, then re-hydrates from defaults. Plugin preferences are
 * untouched; those live on the Plugins page.
 */
export function SystemPrefsResetPanel() {
	const { t } = useTranslation()
	const confirm = useConfirmDialog<true>()

	const resetMut = useToastMutation({
		...systemPrefRemoveAllMutation(),
		successToastKey: "me.systemPrefs.resetSuccess",
		errorToastKey: "common.error",
		onSuccess: () => {
			for (const key of prefSyncStore.keys()) {
				prefSyncStore.delete(key)
				try {
					localStorage.removeItem(key)
				} catch {}
				broadcastPrefSyncDelete(key)
			}
			invalidateSystemPrefsHydration()
			void hydrateSystemPrefs()
			pushPrefsChanged()
		},
	})

	return (
		<>
			<Button
				variant="destructive"
				onClick={() => confirm.open(true)}
				disabled={resetMut.isPending}
				data-testid="reset-system-prefs"
			>
				<Icon icon={Restart} />
				{resetMut.isPending ? t("common.working") : t("me.systemPrefs.restore")}
			</Button>

			<ConfirmDialog
				open={confirm.isOpen}
				onOpenChange={confirm.onOpenChange}
				title={t("me.systemPrefs.confirmTitle")}
				description={t("me.systemPrefs.confirmDescription")}
				confirmLabel={t("me.systemPrefs.restore")}
				pendingLabel={t("common.working")}
				isPending={resetMut.isPending}
				destructive
				onConfirm={() => resetMut.mutate(undefined)}
			/>
		</>
	)
}
