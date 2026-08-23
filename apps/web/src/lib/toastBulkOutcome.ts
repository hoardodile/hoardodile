import { toast } from "@hoardodile/ui/components/toast"
import type { Translate } from "@/i18n"

/**
 * Shared bulk-operation outcome toast for the resource / character batch
 * mutations: all-ok success, all-failed error, partial warning. The i18n
 * keys live under `<ns>.bulk.toastAllOk|toastAllFailed|toastPartial`.
 */
export function toastBulkOutcome(
	t: Translate,
	ns: "resources" | "characters",
	okCount: number,
	failures: readonly { readonly message: string }[],
): void {
	if (failures.length === 0) {
		toast.add({
			title: t(`${ns}.bulk.toastAllOk`, { count: okCount }),
			type: "success",
		})
		return
	}
	if (okCount === 0) {
		toast.add({
			title: t(`${ns}.bulk.toastAllFailed`, { count: failures.length }),
			type: "error",
		})
		return
	}
	toast.add({
		title: t(`${ns}.bulk.toastPartial`, {
			ok: okCount,
			failed: failures.length,
		}),
		type: "warning",
	})
}
