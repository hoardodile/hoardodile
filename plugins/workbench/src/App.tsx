import { decideDownloadConsent } from "@hoardodile/host-web"
import { applyTheme } from "@hoardodile/sdk-web"
import { PluginDownloadConsentDialog } from "@hoardodile/ui/components/plugin-download-consent"
import { useEffect, useMemo, useRef, useState } from "react"
import { Stage } from "./components/Stage.tsx"
import { Toolbar } from "./components/Toolbar.tsx"
import {
	describeViewport,
	loadWorkbenchConfig,
	resolveWorkbenchLanguage,
	resolveWorkbenchTheme,
	saveWorkbenchConfig,
	type WorkbenchConfig,
} from "./config.ts"
import { useDownloadConsentEntry } from "./consent-bridge.ts"
import {
	buildContext,
	describeContext,
	fetchContext,
	fetchJson,
	type IframePresentation,
	type ResourceContext,
	type WorkbenchManifest,
	type WorkbenchResource,
} from "./context.ts"
import { type Mounted, mountIframe, pushPresentation } from "./host.ts"

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
 */
export function App() {
	const [config, setConfig] = useState<WorkbenchConfig>(() =>
		loadWorkbenchConfig(),
	)
	const [manifest, setManifest] = useState<WorkbenchManifest | null>(null)
	const [bootstrapError, setBootstrapError] = useState<string | null>(null)
	const [resources, setResources] = useState<readonly WorkbenchResource[]>([])
	const [selectedId, setSelectedId] = useState<string>()
	const [reloadNonce, setReloadNonce] = useState(0)
	const [context, setContext] = useState<ResourceContext | null>(null)
	const [systemDark, setSystemDark] = useState(readSystemDark)
	const frameRef = useRef<HTMLDivElement | null>(null)
	const mountedRef = useRef<Mounted | null>(null)
	const consentEntry = useDownloadConsentEntry()

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
	// dev sees exactly what the plugin sees.
	useEffect(() => {
		applyTheme(
			presentation.resolvedTheme,
			presentation.palette,
			presentation.iconStyle,
		)
	}, [presentation.resolvedTheme, presentation.palette, presentation.iconStyle])

	useEffect(() => {
		saveWorkbenchConfig(config)
	}, [config])

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
		const container = frameRef.current
		if (container === null) return
		const mounted = mountIframe({
			manifest,
			resource,
			ctx: context,
			context: buildContext(
				manifest.id,
				resource,
				context,
				presentationRef.current,
			),
			container,
		})
		mountedRef.current = mounted
		lastPushedRef.current = presentationRef.current
		return () => {
			mounted.dispose()
			mountedRef.current = null
		}
	}, [manifest, resource, context])

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

	return (
		<div className="flex h-full flex-col">
			<Toolbar
				manifest={manifest}
				resources={resources}
				resource={resource}
				status={context === null ? "loading…" : describeContext(context)}
				viewportLabel={describeViewport(config.viewport)}
				config={config}
				onConfigChange={patchConfig}
				onSelect={setSelectedId}
				onReload={() => setReloadNonce((n) => n + 1)}
			/>
			{bootstrapError !== null ? (
				<Stage
					viewport={config.viewport}
					loading={false}
					frameRef={frameRef}
					emptyTitle="Workbench failed to start"
					emptyDescription={bootstrapError}
				/>
			) : resource === undefined ? (
				<Stage
					viewport={config.viewport}
					loading={false}
					frameRef={frameRef}
					emptyTitle="No resources"
					emptyDescription="pass --data <dir> or --storage <hoardodile-root>"
				/>
			) : (
				<Stage
					viewport={config.viewport}
					loading={context === null}
					frameRef={frameRef}
				/>
			)}
			<PluginDownloadConsentDialog
				entry={consentEntry}
				onDeny={(ticketId) => decideDownloadConsent(ticketId, false)}
				onAllow={(ticketId) => decideDownloadConsent(ticketId, true)}
			/>
		</div>
	)
}
