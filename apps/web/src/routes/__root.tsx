import { Toaster } from "@hoardodile/ui/components/toast"
import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query"
import {
	createRootRouteWithContext,
	Outlet,
	useRouterState,
} from "@tanstack/react-router"
import { useEffect, useLayoutEffect } from "react"
import { useTranslation } from "react-i18next"
import { AppShell } from "@/components/layout/AppShell"
import { useAuthSession } from "@/features/auth/session"
import {
	closeDownloadConsent,
	enqueueDownloadConsent,
	rehydrateDownloadConsent,
} from "@/features/plugin/download/consent-store"
import { DownloadConsentDialog } from "@/features/plugin/download/DownloadConsentDialog"
import { useSessionProtection } from "@/features/privacy/useSessionProtection"
import { maintenanceOptions } from "@/features/protection/api"
import { FileWriteNotice } from "@/features/protection/FileWriteNotice"
import { MaintenanceScreen } from "@/features/protection/MaintenanceScreen"
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
	const authenticated = useAuthSession()
	const maintenance = useQuery({
		...maintenanceOptions(),
		enabled: authenticated,
	})
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	})
	const authenticationPage =
		pathname === "/login" || pathname === "/unlock" || pathname === "/setup"
	useSessionProtection()
	useLayoutEffect(() => {
		if (authenticationPage || authenticated) {
			const root = document.getElementById("root")
			if (root) root.style.visibility = ""
		}
	}, [authenticationPage, authenticated])
	useEffect(
		function startSse() {
			if (!authenticated) return
			function rehydrateConsent() {
				void trpcQuery("pluginAsset", "listPending")
					.then((pending) => rehydrateDownloadConsent(pending))
					.catch(() => {})
			}
			// The consent dialog must never depend on the SSE stream alone:
			// a lost broadcast (vite dev proxy buffering, momentary gaps)
			// would otherwise delay a ticket until the next reconnect.
			// Rehydrate on every open AND on a light interval — the query
			// is small and idempotent (`rehydrateDownloadConsent` replaces
			// the queue, deduped by ticketId).
			const rehydrateTimer = setInterval(rehydrateConsent, 5_000)
			const stop = connectEventSource(queryClient, {
				onEvent: (evt) =>
					handleSseEvent(queryClient, evt, t("dataHistory.reloading")),
				onReconnect: () => {
					rehydrateConsent()
				},
			})
			return () => {
				clearInterval(rehydrateTimer)
				stop()
			}
		},
		[queryClient, t, authenticated],
	)
	return (
		<div
			className={isHoardodileDesktop() ? "h-svh overflow-hidden" : undefined}
		>
			{maintenance.data && !authenticationPage ? (
				<MaintenanceScreen />
			) : (
				<AppShell>
					{!authenticationPage && <FileWriteNotice />}
					<Outlet />
				</AppShell>
			)}
			{authenticated && <DownloadConsentDialog />}
			<Toaster />
		</div>
	)
}
