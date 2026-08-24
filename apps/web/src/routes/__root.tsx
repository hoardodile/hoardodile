import { Toaster } from "@hoardodile/ui/components/toast"
import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { AppShell } from "@/components/layout/AppShell"
import {
	closeDownloadConsent,
	enqueueDownloadConsent,
	rehydrateDownloadConsent,
} from "@/features/plugin/download/consent-store"
import { DownloadConsentDialog } from "@/features/plugin/download/DownloadConsentDialog"
import { useAutoLogout } from "@/features/privacy/useAutoLogout"
import { notifyImageHashesReady } from "@/features/res/api/dup-toast"
import { handleResourceMetaUpdated } from "@/features/res/api/sse-handler"
import { hardResetAndReload } from "@/lib/client-reset"
import { isHoardodileDesktop } from "@/lib/desktop"
import type { SseEvent } from "@/lib/sse"
import { connectEventSource } from "@/lib/sse"
import type { TRPC } from "@/trpc/client"
import { trpcQuery } from "@/trpc/factory"

export type RouterContext = {
	queryClient: QueryClient
	trpc: TRPC
}

export const Route = createRootRouteWithContext<RouterContext>()({
	component: RootComponent,
})

export async function handleSseEvent(
	queryClient: QueryClient,
	evt: SseEvent,
	reloadingMessage?: string,
): Promise<void> {
	if (evt.type === "resourceMetaUpdated") {
		if (evt.metaTypes.includes("imageHashes")) {
			// Wake one-shot upload listeners (duplicate warning toast).
			notifyImageHashesReady(evt.resourceId)
		}
		handleResourceMetaUpdated(queryClient, evt)
		return
	}
	if (evt.type === "storageContextReloaded") {
		// The underlying database has been replaced. Wipe every form of
		// persisted client state and reload so the app starts fresh against
		// the new storage context.
		void hardResetAndReload(reloadingMessage)
		return
	}
	if (evt.type === "pluginDownloadRequested") {
		enqueueDownloadConsent(evt)
		return
	}
	if (evt.type === "pluginDownloadResolved") {
		closeDownloadConsent(evt.ticketId)
	}
}

function RootComponent() {
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	useAutoLogout()
	useEffect(
		function startSse() {
			return connectEventSource(queryClient, {
				onEvent: (evt) =>
					handleSseEvent(queryClient, evt, t("dataHistory.reloading")),
				// Broadcasts can be lost while the stream is down — repull
				// the broker's pending tickets so dialogs reappear.
				onReconnect: () => {
					void trpcQuery("pluginAsset", "listPending")
						.then((pending) => rehydrateDownloadConsent(pending))
						.catch(() => {})
				},
			})
		},
		[queryClient, t],
	)
	return (
		<div
			className={isHoardodileDesktop() ? "h-svh overflow-hidden" : undefined}
		>
			<AppShell>
				<Outlet />
			</AppShell>
			<DownloadConsentDialog />
			<Toaster />
		</div>
	)
}
