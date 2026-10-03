import type { PluginIframeContext } from "@hoardodile/sdk-web"
import { apiPaths } from "@/lib/paths"
import {
	registerIframe,
	resolvePluginMessageSource,
	unregisterIframe,
} from "./iframe-registry"
import { pluginOverlays } from "./mobile-overlays"
import { createTransport } from "./transport"

export type PluginIframeInstance = {
	readonly iframe: HTMLIFrameElement
	readonly release: () => void
	readonly postContext: (ctx: PluginIframeContext) => void
	readonly setVisibility: (visible: boolean) => void
	readonly onLoaded: (cb: () => void) => () => void
	readonly whenLoaded: () => Promise<void>
	/** Replays once the resource is painted, or the legacy SDK timeout expires. */
	readonly onReady: (cb: () => void) => () => void
	/** Reload changed assets before posting the context; records a cold fingerprint without reloading. */
	readonly reloadAsset: (assetVersion: string) => boolean
}

let container: HTMLElement | undefined
const instances = new Map<HTMLIFrameElement, () => void>()

/** The app host owns teardown, including instances mounted inline. */
export function setIframeContainer(next: HTMLElement | undefined): void {
	if (next === container) return
	for (const release of instances.values()) release()
	container = next
}

/** One document for one resource and owner. Released documents are never reused. */
export function createPluginIframe(opts: {
	readonly pluginId: string
	readonly resId?: string
	readonly assetVersion?: string
	readonly ackTimeoutMs?: number
	/** Inline surfaces create the document in its final parent, avoiding a reload on reparent. */
	readonly parent?: HTMLElement
}): PluginIframeInstance {
	const parent = opts.parent ?? container
	if (parent === undefined) throw new Error("Plugin iframe host not mounted")
	const iframe = document.createElement("iframe")
	iframe.sandbox.add("allow-scripts", "allow-forms", "allow-downloads")
	iframe.referrerPolicy = "no-referrer"
	iframe.allowFullscreen = true
	iframe.src = apiPaths.plugins.indexHtml(opts.pluginId, opts.assetVersion)
	iframe.title = `plugin:${opts.pluginId}`
	iframe.style.cssText =
		"position:fixed;border:0;display:none;pointer-events:auto;z-index:0"
	const transport = createTransport(iframe)
	const loadedListeners = new Set<() => void>()
	const loadWaiters = new Set<() => void>()
	const readyListeners = new Set<() => void>()
	let source: Window | null = null
	let active = true
	let loaded = false
	let ready = false
	let resId = opts.resId
	let assetVersion = opts.assetVersion

	function bindSource(): void {
		const current = iframe.contentWindow
		if (source !== null && source !== current) unregisterIframe(source)
		source = current
		if (source !== null)
			registerIframe(source, { pluginId: opts.pluginId, resId: resId ?? "" })
	}

	function settleLoad(): void {
		for (const resolve of loadWaiters) resolve()
		loadWaiters.clear()
	}

	function handleLoad(): void {
		if (!active) return
		loaded = true
		bindSource()
		settleLoad()
		for (const cb of loadedListeners) cb()
	}

	function fireReady(): void {
		if (!active || ready) return
		ready = true
		clearTimeout(fallbackTimer)
		for (const cb of readyListeners) cb()
		readyListeners.clear()
	}

	function handlePainted(event: MessageEvent): void {
		const msg: unknown = event.data
		if (
			typeof msg !== "object" ||
			msg === null ||
			!("type" in msg) ||
			msg.type !== "contextPainted" ||
			!("resId" in msg) ||
			typeof msg.resId !== "string"
		)
			return
		const resolved = resolvePluginMessageSource(event)
		if (
			resolved?.source !== source ||
			source === null ||
			(resId !== undefined && msg.resId !== resId)
		)
			return
		fireReady()
	}

	const fallbackTimer = setTimeout(fireReady, opts.ackTimeoutMs ?? 300)
	iframe.addEventListener("load", handleLoad)
	iframe.addEventListener("error", handleLoad)
	window.addEventListener("message", handlePainted)

	function release(): void {
		if (!active) return
		active = false
		clearTimeout(fallbackTimer)
		window.removeEventListener("message", handlePainted)
		iframe.removeEventListener("load", handleLoad)
		iframe.removeEventListener("error", handleLoad)
		loadedListeners.clear()
		readyListeners.clear()
		// Wake pending bootstrap work so its owner can discard it on cleanup.
		settleLoad()
		transport.setVisibility(false)
		transport.dispose()
		const releasedSource = source
		let removed = false
		let removalTimer: ReturnType<typeof setTimeout> | undefined
		function removeDocument(): void {
			if (removed) return
			removed = true
			clearTimeout(removalTimer)
			iframe.removeEventListener("load", removeDocument)
			iframe.remove()
			if (releasedSource !== null)
				setTimeout(() => unregisterIframe(releasedSource), 100)
		}
		iframe.style.display = "none"
		if (loaded && iframe.isConnected) {
			// Deliver hidden state before destruction so SDK writers can flush.
			removalTimer = setTimeout(removeDocument, 100)
			iframe.dataset.retiring = "true"
		} else removeDocument()
		instances.delete(iframe)
	}

	instances.set(iframe, release)
	parent.appendChild(iframe)
	return {
		iframe,
		release,
		postContext(ctx) {
			if (
				!active ||
				ctx.pluginId !== opts.pluginId ||
				(resId !== undefined && ctx.resId !== resId)
			)
				return
			resId = ctx.resId
			bindSource()
			transport.pushContext(ctx)
		},
		setVisibility(visible) {
			if (active) transport.setVisibility(visible)
		},
		reloadAsset(next) {
			if (!active || next === assetVersion) return false
			if (assetVersion === undefined) {
				assetVersion = next
				return false
			}
			assetVersion = next
			loaded = false
			if (source !== null) pluginOverlays.release(source)
			iframe.src = apiPaths.plugins.indexHtml(opts.pluginId, next)
			return true
		},
		onLoaded(cb) {
			if (!active) return () => {}
			if (loaded) {
				cb()
				return () => {}
			}
			loadedListeners.add(cb)
			return () => {
				loadedListeners.delete(cb)
			}
		},
		whenLoaded() {
			if (loaded || !active) return Promise.resolve()
			return new Promise<void>((resolve) => {
				loadWaiters.add(resolve)
			})
		},
		onReady(cb) {
			if (!active) return () => {}
			if (ready) {
				cb()
				return () => {}
			}
			readyListeners.add(cb)
			return () => {
				readyListeners.delete(cb)
			}
		},
	}
}
