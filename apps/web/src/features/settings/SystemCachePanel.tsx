import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { Icon } from "@hoardodile/ui/components/icon"
import { Eraser } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { useConfirmDialog } from "@/components/common/useConfirmDialog"
import { hardResetAndReload } from "@/lib/client-reset"

/**
 * "Browser cache" is the browser-side local cache — service-worker caches,
 * CacheStorage, localStorage, sessionStorage and IndexedDB (offline usage
 * queue, document drafts). Clearing it never touches the server; the page
 * reloads with everything rebuilt from the server.
 */
export function SystemCachePanel() {
	const { t } = useTranslation()
	const confirm = useConfirmDialog<true>()

	function handleConfirm() {
		// Never returns: ends in window.location.reload().
		void hardResetAndReload(t("me.systemCache.resetting"))
	}

	return (
		<>
			<Button
				variant="destructive"
				onClick={() => confirm.open(true)}
				data-testid="clear-browser-cache"
			>
				<Icon icon={Eraser} />
				{t("me.systemCache.clear")}
			</Button>

			<ConfirmDialog
				open={confirm.isOpen}
				onOpenChange={confirm.onOpenChange}
				title={t("me.systemCache.confirmTitle")}
				description={t("me.systemCache.confirmDescription")}
				confirmLabel={t("me.systemCache.clear")}
				pendingLabel={t("me.systemCache.clearing")}
				isPending={false}
				destructive
				onConfirm={handleConfirm}
			/>
		</>
	)
}
