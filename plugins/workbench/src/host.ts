import {
	createMockDanmakuStore,
	createMockHost,
	createMockMessageStore,
	type MockHost,
} from "@hoardodile/host-web"
import type { Danmaku, Message } from "@hoardodile/sdk-types"
import { hostPushKeys, type PluginIframeContext } from "@hoardodile/sdk-web"
import { createAssetVault } from "./consent-bridge.ts"
import {
	createHttpFileBackend,
	type IframePresentation,
	type ResourceContext,
	type WorkbenchManifest,
	type WorkbenchResource,
} from "./context.ts"
import { observeDanmaku, observeMessages } from "./observe.ts"

/**
 * One mounted plugin iframe plus the mock host bound to it. The iframe
 * element is created imperatively and appended to the stage container —
 * the same ownership model as the app's iframe pool (React never
 * re-parents it).
 */

export type Mounted = {
	readonly host: MockHost
	readonly win: Window | null
	readonly dispose: () => void
}

/**
 * How a live plugin write is captured into the persistent workbench
 * session. The mock host's handlers fire these; the App forwards each to
 * the session store so a refresh re-seeds the value. `prefs` is
 * plugin-scoped, `cache` per (plugin, resource); messages/danmaku carry
 * their own resource id.
 */
export type SessionRecorder = {
	readonly recordPref: (pluginId: string, key: string, value: string) => void
	readonly recordCache: (
		pluginId: string,
		resId: string,
		key: string,
		value: string,
	) => void
	readonly recordMessage: (resId: string, message: Message) => void
	readonly recordDanmaku: (resId: string, danmaku: Danmaku) => void
}

export function mountIframe(opts: {
	readonly manifest: WorkbenchManifest
	readonly resource: WorkbenchResource
	readonly ctx: ResourceContext
	readonly context: PluginIframeContext
	readonly container: HTMLElement
	readonly recorder: SessionRecorder
}): Mounted {
	const { manifest, resource, ctx, context, container, recorder } = opts
	const messages = observeMessages(
		createMockMessageStore(ctx.state?.messages ?? []),
		recorder.recordMessage,
	)
	const danmaku = observeDanmaku(
		createMockDanmakuStore(ctx.state?.danmaku ?? []),
		recorder.recordDanmaku,
	)
	const host = createMockHost({
		targetWindow: window,
		files: createHttpFileBackend(resource.id, () => ctx.snapshot),
		messages,
		danmaku,
		prefs: ctx.state?.prefs,
		cache: ctx.state?.cache,
		onPrefChanged: (key, value) => recorder.recordPref(manifest.id, key, value),
		onCacheChanged: (resId, key, value) =>
			recorder.recordCache(manifest.id, resId, key, value),
		assetVault: createAssetVault(manifest),
	})

	container.replaceChildren()
	const frame = document.createElement("iframe")
	// Element-level attributes mirror the app's pooled iframes exactly
	// (apps/web/src/features/plugin/iframe/iframe-pool.ts).
	frame.src = "/plugin/index.html"
	frame.title = `plugin:${manifest.id}`
	frame.sandbox.add("allow-scripts", "allow-forms", "allow-downloads")
	frame.referrerPolicy = "no-referrer"
	frame.allowFullscreen = true
	frame.style.position = "absolute"
	frame.style.inset = "0"
	frame.style.width = "100%"
	frame.style.height = "100%"
	frame.style.border = "0"
	container.appendChild(frame)

	const state: { win: Window | null } = { win: null }
	frame.addEventListener("load", () => {
		const win = frame.contentWindow
		if (win === null) return
		state.win = win
		host.register(win, { pluginId: manifest.id, resId: resource.id })
		host.pushContext(win, context)
		host.setVisibility(win, true)
	})

	return {
		host,
		get win() {
			return state.win
		},
		dispose() {
			if (state.win !== null) host.unregister(state.win)
			host.dispose()
			frame.remove()
		},
	}
}

/**
 * Live-apply a config change to a mounted iframe — the same push sequence
 * the app broadcasts (`apps/web/src/features/plugin/iframe/pushes.ts`):
 * theme, fonts and language go out as pushes, so the plugin tree is NOT
 * remounted. A plugin built against a vanilla SDK never subscribed to
 * these pushes and keeps rendering the initial context — Reload re-posts
 * the context with the new values.
 */
export function pushPresentation(
	mounted: Mounted,
	p: IframePresentation,
): void {
	const { win } = mounted
	if (win === null) return
	mounted.host.push(win, hostPushKeys.themeChanged, {
		resolvedTheme: p.resolvedTheme,
		palette: p.palette,
		iconStyle: p.iconStyle,
	})
	mounted.host.push(win, hostPushKeys.fontsChanged, p.fonts)
	// Bare language code on the wire — see protocol.ts `languageChanged`.
	mounted.host.push(win, hostPushKeys.languageChanged, p.language)
}
