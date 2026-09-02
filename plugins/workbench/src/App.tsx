import { decideDownloadConsent } from "@hoardodile/host-web"
import { applyTheme } from "@hoardodile/sdk-web"
import { PluginDownloadConsentDialog } from "@hoardodile/ui/components/plugin-download-consent"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useContainerFullscreen } from "./components/FullscreenButton.tsx"
import { MenuBar } from "./components/MenuBar.tsx"
import { ResourceSidebar } from "./components/ResourceSidebar.tsx"
import { Stage } from "./components/Stage.tsx"
import { StatusBar } from "./components/StatusBar.tsx"
import {
	loadWorkbenchConfig,
	resolveWorkbenchLanguage,
	resolveWorkbenchTheme,
	saveWorkbenchConfig,
	type WorkbenchConfig,
} from "./config.ts"
import { useDownloadConsentEntry } from "./consent-bridge.ts"
import {
	buildContext,
	fetchContext,
	fetchJson,
	type IframePresentation,
	type ResourceContext,
	type WorkbenchManifest,
	type WorkbenchResource,
} from "./context.ts"
import { type Mounted, mountIframe, pushPresentation } from "./host.ts"
import { i18n } from "./i18n.ts"
import { subscribeToPluginRebuilds } from "./rebuild-events.ts"
import {
	emptySession,
	hasCacheOverride,
	hasPrefOverride,
	isCacheCleared,
	isPrefsCleared,
	recordCacheWrite,
	recordDanmaku,
	recordMessage,
	recordPrefWrite,
	seedState,
	type WorkbenchSession,
	withClearedCache,
	withClearedPrefs,
	withoutCacheOverride,
	withoutPrefOverride,
} from "./session.ts"
import { createSessionStore, type SessionStore } from "./session-store.ts"

function readSystemDark(): boolean {
	return window.matchMedia("(prefers-color-scheme: dark)").matches
}

function samePresentation(
	a: IframePresentation | null,
	b: IframePresentation,
): boolean {
	if (a === null) return false
	return (
		a.resolvedTheme === b.resolvedTheme &&
		a.palette === b.palette &&
		a.iconStyle === b.iconStyle &&
		a.language === b.language &&
		a.fonts.family === b.fonts.family &&
		a.fonts.cssPaths.length === b.fonts.cssPaths.length
	)
}

/**
 * Workbench page: one plugin iframe against the offline mock host. The
 * config drives both the initial context and the live pushes — changing
 * a setting never remounts the plugin (exactly like the app's theme
 * broadcast); switching resource or Reload does a full remount (the
 * app's preview dialog behavior).
 *
 * The plugin session (prefs/cache writes plus created messages/danmaku) is
 * loaded from IndexedDB before the first mount and recorded back into it
 * on every write, so a refresh re-seeds the same state instead of the
 * read-only library seed. Writes never remount the iframe (the mock host
 * applies them live); relaying the session snapshot is a fire-and-forget
 * persistence concern.
 */
export function App() {
	const [config, setConfig] = useState<WorkbenchConfig>(() =>
		loadWorkbenchConfig(),
	)
	const [session, setSession] = useState<WorkbenchSession | null>(null)
	const [manifest, setManifest] = useState<WorkbenchManifest | null>(null)
	const [bootstrapError, setBootstrapError] = useState<string | null>(null)
	const [resources, setResources] = useState<readonly WorkbenchResource[]>([])
	const [selectedId, setSelectedId] = useState<string>()
	const [resourcesOpen, setResourcesOpen] = useState(false)
	const [reloadNonce, setReloadNonce] = useState(0)
	const [context, setContext] = useState<ResourceContext | null>(null)
	const [systemDark, setSystemDark] = useState(readSystemDark)
	const frameRef = useRef<HTMLDivElement | null>(null)
	const mountedRef = useRef<Mounted | null>(null)
	const sessionRef = useRef<WorkbenchSession>(emptySession())
	const sessionStoreRef = useRef<SessionStore | null>(null)
	const [sessionReady, setSessionReady] = useState(false)
	const consentEntry = useDownloadConsentEntry()
	const fullscreenAPI = useContainerFullscreen(frameRef)

	// Bootstrap: the plugin manifest first, then the resource list. A dev
	// server without the route (or without a captured snapshot yet) still
	// mounts the page, so a client-only plugin can be worked on offline.
	useEffect(() => {
		let cancelled = false
		void (async () => {
			try {
				const m = await fetchJson<WorkbenchManifest>("/plugin/manifest.json")
				if (cancelled) return
				setManifest(m)
				const rs = await fetchJson<readonly WorkbenchResource[]>(
					"/api/workbench/resources",
				).catch(() => [])
				if (cancelled) return
				setResources(rs)
			} catch (err) {
				if (cancelled) return
				setBootstrapError(err instanceof Error ? err.message : String(err))
			}
		})()
		return () => {
			cancelled = true
		}
	}, [])

	// Load the persisted plugin session once, before the first mount. The
	// mount effect gates on `sessionReady` so it runs with the loaded value,
	// while the `session` state above stays available for the UI (which
	// reflects resets/clears) without remounting the iframe on every write.
	useEffect(() => {
		const store = createSessionStore()
		sessionStoreRef.current = store
		let cancelled = false
		void store.load().then((loaded) => {
			if (cancelled) return
			sessionRef.current = loaded
			setSession(loaded)
			setSessionReady(true)
		})
		return () => {
			cancelled = true
		}
	}, [])

	/** Mutate the session snapshot and persist it (coalesced) to IndexedDB. */
	const commitSession = (next: WorkbenchSession) => {
		sessionRef.current = next
		setSession(next)
		sessionStoreRef.current?.save(next)
	}

	const resource = resources.find((r) => r.id === selectedId) ?? resources[0]

	// Fetch the context for the selected resource; a resource switch and
	// Reload both reset to loading, exactly like the old workbench page
	// (dispose → fetch → mount).
	useEffect(() => {
		if (resource === undefined) return
		let cancelled = false
		setContext(null)
		void fetchContext(resource.id).then((ctx) => {
			if (!cancelled) setContext(ctx)
		})
		return () => {
			cancelled = true
		}
	}, [resource, reloadNonce])

	// System theme follows the OS while the mode is "system" (the app's
	// ThemeProvider semantics).
	useEffect(() => {
		if (config.themeMode !== "system") return
		const mq = window.matchMedia("(prefers-color-scheme: dark)")
		const onChange = () => setSystemDark(mq.matches)
		mq.addEventListener("change", onChange)
		return () => mq.removeEventListener("change", onChange)
	}, [config.themeMode])

	const presentation = useMemo<IframePresentation>(
		() => ({
			resolvedTheme: resolveWorkbenchTheme(config.themeMode, systemDark),
			palette: config.palette,
			iconStyle: config.iconStyle,
			language:
				config.language === "system"
					? resolveWorkbenchLanguage(navigator.language)
					: config.language,
			fonts: { family: config.fontFamily, cssPaths: [] },
		}),
		[config, systemDark],
	)

	// The workbench chrome follows the same theme the plugin sees — the
	// dev sees exactly what the plugin sees. `applyTheme` (from
	// `@hoardodile/sdk-web`) now also syncs `color-scheme` on the document,
	// so native chrome (scrollbars, form controls) matches the live theme.
	useEffect(() => {
		applyTheme(
			presentation.resolvedTheme,
			presentation.palette,
			presentation.iconStyle,
		)
	}, [presentation.resolvedTheme, presentation.palette, presentation.iconStyle])

	// The chrome's own language follows the configured language (the
	// plugin iframe receives it in its initial context + pushes).
	useEffect(() => {
		void i18n.changeLanguage(presentation.language)
	}, [presentation.language])

	useEffect(() => {
		saveWorkbenchConfig(config)
	}, [config])

	// Auto-refresh the plugin iframe when the dev watch-build rebuilds the
	// bundle (`hoardodile plugin dev` broadcasts over
	// `/api/workbench/events`). Coalesces rebuild bursts so the iframe does
	// not remount several times in a row; the reload re-seeds the persisted
	// session, exactly like the manual Reload button.
	const lastRebuildAtRef = useRef(0)
	useEffect(() => {
		return subscribeToPluginRebuilds(() => {
			const now = Date.now()
			if (now - lastRebuildAtRef.current < 300) return
			lastRebuildAtRef.current = now
			setReloadNonce((n) => n + 1)
		})
	}, [])

	// Latest presentation for the initial context — the mount effect must
	// not re-run (and remount the iframe) when a setting changes. A fresh
	// iframe gets its presentation from the initial context; only later
	// changes go out as pushes.
	const presentationRef = useRef(presentation)
	const lastPushedRef = useRef<IframePresentation | null>(null)
	useEffect(() => {
		presentationRef.current = presentation
	}, [presentation])

	useEffect(() => {
		if (manifest === null || resource === undefined || context === null) return
		if (!sessionReady) return
		const container = frameRef.current
		if (container === null) return
		const seeded = seedState(
			sessionRef.current,
			manifest.id,
			resource.id,
			context,
		)
		const mounted = mountIframe({
			manifest,
			resource,
			ctx: seeded,
			context: buildContext(
				manifest.id,
				resource,
				seeded,
				presentationRef.current,
			),
			container,
			recorder: {
				recordPref: (pluginId, key, value) =>
					commitSession(
						recordPrefWrite(
							sessionRef.current,
							pluginId,
							context.state?.prefs ?? {},
							key,
							value,
						),
					),
				recordCache: (pluginId, resId, key, value) =>
					commitSession(
						recordCacheWrite(
							sessionRef.current,
							pluginId,
							resId,
							context.state?.cache ?? {},
							key,
							value,
						),
					),
				recordMessage: (resId, message) =>
					commitSession(recordMessage(sessionRef.current, resId, message)),
				recordDanmaku: (resId, danmaku) =>
					commitSession(recordDanmaku(sessionRef.current, resId, danmaku)),
			},
		})
		mountedRef.current = mounted
		lastPushedRef.current = presentationRef.current
		return () => {
			mounted.dispose()
			mountedRef.current = null
		}
	}, [manifest, resource, context, sessionReady])

	// Live pushes: settings changes reach a mounted iframe without a
	// remount (the app's theme/font/language broadcast).
	useEffect(() => {
		const mounted = mountedRef.current
		if (mounted === null) return
		if (samePresentation(lastPushedRef.current, presentation)) return
		lastPushedRef.current = presentation
		pushPresentation(mounted, presentation)
	}, [presentation])

	const patchConfig = (patch: Partial<WorkbenchConfig>) => {
		setConfig((prev) => ({ ...prev, ...patch }))
	}

	// Selecting a resource from the sidebar switches the mounted resource and
	// closes the picker (docked panel collapses / drawer closes).
	const handleSelectResource = (id: string) => {
		setSelectedId(id)
		setResourcesOpen(false)
	}

	// Plugin-state management. Each action updates the workbench session
	// (persisted by `commitSession`) and remounts the iframe via the
	// existing reload path, so the plugin re-seeds from the cleared
	// (empty) baseline instead of the read-only library state.
	const handleResetSettings = () => {
		if (manifest === null) return
		commitSession(withClearedPrefs(sessionRef.current, manifest.id))
		setReloadNonce((n) => n + 1)
	}
	const handleClearCache = () => {
		if (manifest === null || resource === undefined) return
		commitSession(
			withClearedCache(sessionRef.current, manifest.id, resource.id),
		)
		setReloadNonce((n) => n + 1)
	}
	const handleRestoreState = () => {
		if (manifest === null) return
		const next =
			resource === undefined
				? withoutPrefOverride(sessionRef.current, manifest.id)
				: withoutCacheOverride(
						withoutPrefOverride(sessionRef.current, manifest.id),
						manifest.id,
						resource.id,
					)
		commitSession(next)
		setReloadNonce((n) => n + 1)
	}

	const pluginState = {
		prefsCleared:
			manifest !== null &&
			session !== null &&
			isPrefsCleared(session, manifest.id),
		cacheCleared:
			manifest !== null &&
			resource !== undefined &&
			session !== null &&
			isCacheCleared(session, manifest.id, resource.id),
		// Any session state (a reset or recorded writes) so the Restore
		// button appears even when a plugin merely wrote a pref/cache entry.
		prefsChanged:
			manifest !== null &&
			session !== null &&
			hasPrefOverride(session, manifest.id),
		cacheChanged:
			manifest !== null &&
			resource !== undefined &&
			session !== null &&
			hasCacheOverride(session, manifest.id, resource.id),
	}
	const { t: tw } = useTranslation("workbench")

	return (
		<div className="flex h-full flex-col bg-background">
			{/* Full-width top bar: the sidebar never covers it. */}
			<MenuBar
				manifest={manifest}
				resources={resources}
				resource={resource}
				ctx={context}
				config={config}
				pluginState={pluginState}
				fullscreen={fullscreenAPI}
				locale={presentation.language}
				resourcesOpen={resourcesOpen}
				onConfigChange={patchConfig}
				onToggleResources={() => setResourcesOpen((v) => !v)}
				onReload={() => setReloadNonce((n) => n + 1)}
				onResetSettings={handleResetSettings}
				onClearCache={handleClearCache}
				onRestoreState={handleRestoreState}
			/>
			{/* Middle row: the docked resource sidebar (between the bars) and
			    the plugin stage. Only shown while there are multiple resources
			    to switch between. */}
			<div className="flex min-h-0 min-w-0 flex-1">
				{resources.length >= 2 ? (
					<ResourceSidebar
						open={resourcesOpen}
						onOpenChange={setResourcesOpen}
						resources={resources}
						selectedId={resource?.id}
						onSelect={handleSelectResource}
					/>
				) : null}
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					{bootstrapError !== null ? (
						<Stage
							mode={config.mode}
							loading={false}
							frameRef={frameRef}
							emptyTitle={tw("app.failedTitle")}
							emptyDescription={bootstrapError}
						/>
					) : resource === undefined ? (
						<Stage
							mode={config.mode}
							loading={false}
							frameRef={frameRef}
							emptyTitle={tw("app.noResources")}
							emptyDescription={tw("app.noResourcesHint")}
						/>
					) : (
						<Stage
							mode={config.mode}
							loading={context === null || !sessionReady}
							frameRef={frameRef}
						/>
					)}
				</div>
			</div>
			{/* Full-width bottom bar: the sidebar never covers it. */}
			<StatusBar manifest={manifest} mode={config.mode} />
			<PluginDownloadConsentDialog
				entry={consentEntry}
				onDeny={(ticketId) => decideDownloadConsent(ticketId, false)}
				onAllow={(ticketId) => decideDownloadConsent(ticketId, true)}
			/>
		</div>
	)
}
