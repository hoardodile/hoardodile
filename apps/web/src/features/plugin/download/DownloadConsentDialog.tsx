import { PluginDownloadConsentDialog } from "@hoardodile/ui/components/plugin-download-consent"
import { useSyncExternalStore } from "react"
import { formatBytes } from "@/lib/formatBytes"
import { trpcMutate } from "@/trpc/factory"
import {
	getDownloadConsentSnapshot,
	subscribeDownloadConsent,
} from "./consent-store"

/**
 * The app's wiring of the shared consent dialog: the store (host-web)
 * is fed by SSE, this component renders one ticket at a time and routes
 * decisions to the server (`pluginAsset.decide`) — the resolved
 * broadcast closes the entry in every tab.
 */
export function DownloadConsentDialog() {
	const { queue } = useSyncExternalStore(
		subscribeDownloadConsent,
		getDownloadConsentSnapshot,
		getDownloadConsentSnapshot,
	)
	const entry = queue[0] ?? null

	return (
		<PluginDownloadConsentDialog
			entry={entry}
			onDeny={(ticketId) => decide(ticketId, false, false)}
			onAllow={(ticketId, remember) => decide(ticketId, true, remember)}
			formatBytes={formatBytes}
		/>
	)
}

function decide(ticketId: string, approved: boolean, remember: boolean): void {
	void trpcMutate("pluginAsset", "decide", {
		ticketId,
		approved,
		remember,
	}).catch(() => {
		// A failed decide keeps the ticket open (the dialog entry closes
		// only when the server broadcasts the resolution).
	})
}
