import {
	createMockDanmakuStore,
	createMockHost,
	createMockMessageStore,
	type MockHost,
} from "@hoardodile/host-web"
import { hostPushKeys, type PluginIframeContext } from "@hoardodile/sdk-web"
import {
	createHttpFileBackend,
	type IframePresentation,
	type ResourceContext,
	type WorkbenchManifest,
	type WorkbenchResource,
} from "./context.ts"

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

export function mountIframe(opts: {
	readonly manifest: WorkbenchManifest
	readonly resource: WorkbenchResource
	readonly ctx: ResourceContext
	readonly context: PluginIframeContext
	readonly container: HTMLElement
}): Mounted {
	const { manifest, resource, ctx, context, container } = opts
	const host = createMockHost({
		targetWindow: window,
		files: createHttpFileBackend(resource.id, () => ctx.snapshot),
		messages: createMockMessageStore(ctx.state?.messages ?? []),
		danmaku: createMockDanmakuStore(ctx.state?.danmaku ?? []),
		prefs: ctx.state?.prefs,
		cache: ctx.state?.cache,
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
	mounted.host.push(win, hostPushKeys.languageChanged, {
		language: p.language,
	})
}
