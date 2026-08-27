import "./index.css"
import "./i18n"

import { I18nProvider } from "@hoardodile/i18n/react"
import { setNavigationResolver } from "@hoardodile/ui"
import { RoutePendingFallback } from "@hoardodile/ui/components/page-scaffold"
import { TooltipProvider } from "@hoardodile/ui/components/tooltip"
import { MOBILE_INITIAL_SCALE } from "@hoardodile/ui/viewport"
import { QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { Component, type ReactNode, StrictMode, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { AppErrorPage } from "@/components/common/AppErrorPage"
import { FontProvider, useFont } from "@/components/common/FontProvider"
import {
	IconStyleProvider,
	useIconStyle,
} from "@/components/common/IconStyleProvider"
import { ThemeProvider, useTheme } from "@/components/common/ThemeProvider"
import { PluginIframePoolHost } from "@/features/plugin/iframe/PluginIframePoolHost"
import { ensureGlobalHandler } from "@/features/plugin/iframe/plugin-iframe-global-handler"
import {
	pushFontsChanged,
	pushThemeChanged,
} from "@/features/plugin/iframe/pushes"
import { readInheritFont } from "@/features/plugin/iframe/use-iframe-slot"
import { PluginListProvider } from "@/features/plugin/PluginListContext"
import { PrefsSync } from "@/features/prefs"
import { initPrefSyncQueue } from "@/features/prefs/prefSyncQueue"
import { i18n } from "@/i18n"
import { collectRoutePaths } from "@/lib/appRoutes"
import { holdSplashUntilReady } from "@/lib/boot-splash"
import {
	flushClientLogToServer,
	initClientLogging,
	pushClientLog,
} from "@/lib/clientLog"
import { getDesktopBridge, isHoardodileDesktop } from "@/lib/desktop"
import { collectFontCssPaths } from "@/lib/fonts"
import { armLastRouteRestore, writeLastRoute } from "@/lib/last-route"
import { dismissSplash } from "@/lib/splash-handoff"
import {
	createQueryClient,
	createTrpc,
	createTrpcClient,
	setTrpcClient,
} from "@/trpc/client"
import { routeTree } from "./routeTree.gen"

function ThemeBroadcast() {
	const { resolvedTheme, palette } = useTheme()
	const { iconStyle } = useIconStyle()
	useEffect(() => {
		pushThemeChanged({ resolvedTheme, palette, iconStyle })
	}, [resolvedTheme, palette, iconStyle])
	return null
}

function FontBroadcast() {
	const { appFonts, fontFamily } = useFont()
	useEffect(() => {
		pushFontsChanged(
			{ family: fontFamily, cssPaths: collectFontCssPaths(appFonts) },
			(pluginId) => readInheritFont(queryClient, pluginId),
		)
	}, [appFonts, fontFamily])
	return null
}

const queryClient = createQueryClient()
const trpcClient = createTrpcClient()
setTrpcClient(trpcClient)
initPrefSyncQueue()
const trpc = createTrpc(trpcClient, queryClient)

// Global plugin iframe message handler (ref-counted, lives for app lifetime)
ensureGlobalHandler(queryClient)

// Capture console / window / unhandled-rejection errors before the first
// frame so the ring buffer has the crash context the About page exports.
initClientLogging()

if (isHoardodileDesktop()) {
	document.documentElement.classList.add("desktop-shell")
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
	if (isHoardodileDesktop()) {
		// A service worker on http://127.0.0.1 stale-caches across installer
		// updates. Skip registration in the desktop renderer and drop any
		// controller left behind from an earlier browser session on this origin.
		void navigator.serviceWorker.getRegistrations().then((registrations) => {
			for (const registration of registrations) {
				void registration.unregister()
			}
		})
	} else {
		navigator.serviceWorker.register("/sw.js").catch(console.error)
		// Sync allowed plugin IDs to the SW whenever the controller changes.
		navigator.serviceWorker.addEventListener("controllerchange", () => {
			const controller = navigator.serviceWorker.controller
			if (controller === null) return
			// The SW will receive this message and know which plugins to cache.
			// The actual plugin list is sent by SwCacheSync component after tRPC loads.
		})
	}
}

const router = createRouter({
	routeTree,
	context: { queryClient, trpc },
	defaultPreload: "intent",
	defaultPendingMs: 200,
	defaultPendingMinMs: 120,
	defaultPendingComponent: RoutePendingFallback,
	defaultErrorComponent: AppErrorPage,
})

// Desktop shell navigation policy: register the SPA's real routes so the
// main process only ever keeps same-origin navigations that target one of
// them in the window; every other URL goes to the OS browser.
if (isHoardodileDesktop()) {
	getDesktopBridge()?.registerAppRoutes(collectRoutePaths(routeTree))
}

// Desktop reopen continuity: remember the resolved route so a recreated
// window (tray reopen, relaunch) returns to the page the user left after
// signing in; arm the one-shot restore for this boot. Browser tabs are
// untouched — the key is written and read on desktop only.
if (isHoardodileDesktop()) {
	armLastRouteRestore(collectRoutePaths(routeTree))
	router.subscribe("onResolved", () => {
		if (isHoardodileDesktop()) writeLastRoute(router.state.location.href)
	})
}

// Wire the router's navigation lifecycle into the mobile overlay
// back-to-close hook so it can wait for navigation to resolve before
// inspecting history.state (instead of relying on timing heuristics).
setNavigationResolver((fn) => router.subscribe("onResolved", fn))

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router
	}
}

document.documentElement.style.setProperty(
	"--mobile-initial-scale",
	String(MOBILE_INITIAL_SCALE),
)

/**
 * Last-resort boundary above the router: catches crashes in the provider
 * stack (theme, fonts, query client, plugin hosts) that the router's own
 * error components cannot see. Renders the same AppErrorPage in its
 * standalone frame — reload (window reload on desktop) is the recovery.
 */
class AppRootErrorBoundary extends Component<
	{ readonly children: ReactNode },
	{ readonly error: unknown }
> {
	override state: { error: unknown } = { error: undefined }

	static getDerivedStateFromError(error: unknown): { error: unknown } {
		return { error }
	}

	override componentDidCatch(error: unknown): void {
		pushClientLog(
			"error",
			error instanceof Error ? error.message : String(error),
			error instanceof Error ? error.stack : undefined,
		)
		void flushClientLogToServer()
	}

	override render(): ReactNode {
		const error = this.state.error
		if (error === undefined) return this.props.children
		return <AppErrorPage error={error} standalone />
	}
}

const rootElement = document.getElementById("root")
if (!rootElement) {
	throw new Error("#root element not found")
}

// The index.html splash keeps the first frame from being an empty canvas
// while React mounts. Hold the dimmed logo until the initial route has
// resolved and its queries have data: a cold load (desktop tray reopen,
// relaunch, browser refresh) then goes logo → finished page, never through
// the route-pending / section skeletons. The deadline in the gate
// guarantees removal even if a query hangs. Subscribed before render so the
// first `onResolved` can never be missed.
holdSplashUntilReady({
	router,
	queryClient,
	// The overlay (background + dimmed logo) fades out as one surface,
	// revealing the finished page beneath — no moving logo, no swap.
	remove: () => dismissSplash(document.getElementById("app-splash")),
})

createRoot(rootElement).render(
	<StrictMode>
		<I18nProvider i18n={i18n}>
			<AppRootErrorBoundary>
				<ThemeProvider defaultPalette="mono">
					<IconStyleProvider>
						<FontProvider>
							<ThemeBroadcast />
							<FontBroadcast />
							<TooltipProvider>
								<QueryClientProvider client={queryClient}>
									<PluginListProvider>
										<PluginIframePoolHost />
										<PrefsSync />
										<RouterProvider router={router} />
									</PluginListProvider>
								</QueryClientProvider>
							</TooltipProvider>
						</FontProvider>
					</IconStyleProvider>
				</ThemeProvider>
			</AppRootErrorBoundary>
		</I18nProvider>
	</StrictMode>,
)
