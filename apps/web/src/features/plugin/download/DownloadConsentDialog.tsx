import { PluginDownloadConsentDialog } from "@hoardodile/ui/components/plugin-download-consent"
import { useSyncExternalStore } from "react"
import { formatBytes } from "@/lib/formatBytes"
import { trpcMutate } from "@/trpc/factory"
import {
	closeDownloadConsent,
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
			// The plugin iframe pool sits at z-60 (see PluginIframePoolHost) —
			// deliberately above every z-50 Radix dialog, so plugin previews
			// float over app dialogs. This consent question must win that
			// layer or the preview window covers it and swallows its clicks.
			overlayClassName="z-[70]"
			contentClassName="z-[70]"
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
	})
		.then(() => {
			// Local close: the entry normally closes when the server
			// broadcasts the resolution, but a ticket already resolved
			// (consent timeout) or a broadcast lost to an SSE gap turns the
			// server-side decide into a silent no-op. Without this the stale
			// entry stays queued forever and blocks later tickets.
			closeDownloadConsent(ticketId)
		})
		.catch(() => {
			// A failed decide keeps the ticket open (the dialog entry closes
			// only when the server broadcasts the resolution).
		})
}
