import type { PluginContextPainted, PluginIframeContext } from "./protocol.ts"
import { hostPushKeys, PROTOCOL_VERSION } from "./protocol.ts"

let pluginContext: PluginIframeContext | undefined

/** The last context pushed by the host, if any. */
export function getPluginContext(): PluginIframeContext | undefined {
	return pluginContext
}

function setPluginContext(ctx: PluginIframeContext): void {
	pluginContext = ctx
}

// ── Visibility (framework-agnostic store) ────────────────────────────────

let currentVisibility = true
const visibilityListeners = new Set<(visible: boolean) => void>()

/**
 * Subscribe to iframe visibility changes (tab hidden, iframe released,
 * overlays opened by the host). The callback receives the current
 * visibility; returns an unsubscribe function. Backs `useVisibility`
 * in `@hoardodile/sdk-react`.
 */
export function subscribeToVisibility(
	cb: (visible: boolean) => void,
): () => void {
	visibilityListeners.add(cb)
	return () => {
		visibilityListeners.delete(cb)
	}
}

/** Current visibility snapshot without subscribing. */
export function getVisibilitySnapshot(): boolean {
	return currentVisibility
}

function publishVisibilityChange(visible: boolean): void {
	if (currentVisibility === visible) return
	currentVisibility = visible
	for (const cb of visibilityListeners) {
		cb(visible)
	}
}

// ── Mount lifecycle ──────────────────────────────────────────────────────

/**
 * Invokes `cb` once the current DOM state has painted: the first rAF
 * frame paints the pending tree, the second guarantees the compositor
 * surface update landed. If rAF is throttled (document not rendering)
 * `cb` never fires — callers need their own fallback.
 */
function afterNextPaintedFrame(cb: () => void): void {
	requestAnimationFrame(() => {
		requestAnimationFrame(cb)
	})
}

/**
 * Sets up listeners for host→plugin communication via `postMessage` and
 * `CustomEvent` fallback. The host pushes context and visibility updates;
 * this function invokes `mount(ctx)` whenever a new context arrives.
 *
 * Lifecycle contract: the host may replace the context at any time — a
 * pooled iframe document is reused across resources without a reload — so
 * `mount` runs once per context, not once per page load. Clean up
 * per-resource state yourself, or rely on `createPluginRoot` from
 * `@hoardodile/sdk-react`, which remounts the tree by `resId` by
 * default. When the host rebinds the iframe to a new resource, a late
 * unmount cache flush stamped with the old resId is stale-dropped by the
 * host (the plugin's debounced write still lands via the new binding).
 */
export function mountPlugin(mount: (ctx: PluginIframeContext) => void): void {
	function applyContext(ctx: PluginIframeContext) {
		setPluginContext(ctx)
		// A fresh context means the host is showing this iframe again.
		// Publish rather than assign so plugins that keep their tree
		// mounted across contexts (remountOnResourceChange: false) wake
		// up after a release pushed visible:false; the publish helper
		// already dedupes no-change transitions.
		publishVisibilityChange(true)
		mount(ctx)
		// Acknowledge only once the new tree has painted into the iframe's
		// compositor surface: the host keeps a freshly claimed iframe
		// transparent (but painted) until this ack arrives, and a bare DOM
		// commit would still replay the previous resource's last frame for
		// a frame or two while the new raster is in flight. If rAF is
		// throttled the ack never fires and the host's fallback takes over.
		afterNextPaintedFrame(() => {
			window.parent.postMessage(
				{
					type: "contextPainted",
					resId: ctx.resId,
					proto: PROTOCOL_VERSION,
				} satisfies PluginContextPainted,
				"*",
			)
		})
	}

	window.addEventListener("message", (event: MessageEvent) => {
		// Only trust context/visibility pushes from the host parent window.
		if (event.source !== window.parent) return
		const msg = event.data
		if (!isRecord(msg) || msg.type !== "push") return
		if (msg.key === hostPushKeys.context) {
			applyContext(msg.data as PluginIframeContext)
		} else if (msg.key === hostPushKeys.visibility) {
			publishVisibilityChange((msg.data as { visible: boolean }).visible)
		}
	})

	window.addEventListener("context-ready", (e: Event) => {
		applyContext((e as CustomEvent<PluginIframeContext>).detail)
	})
	window.addEventListener("visibility-changed", (e: Event) => {
		publishVisibilityChange(
			(e as CustomEvent<{ visible: boolean }>).detail.visible,
		)
	})

	const w = window as unknown as Record<string, unknown>
	if (w.__pluginContext !== undefined) {
		applyContext(w.__pluginContext as PluginIframeContext)
	}
	if (w.__pluginVisibility !== undefined) {
		publishVisibilityChange(
			(w.__pluginVisibility as { visible: boolean }).visible,
		)
	}
}

// ── Theme & font application ─────────────────────────────────────────────

/** Applies theme classes to `document.documentElement` so CSS variables update. */
export function applyTheme(
	resolvedTheme: string,
	palette: string,
	iconStyle: string,
): void {
	const root = document.documentElement
	root.classList.remove("light", "dark")
	root.classList.add(resolvedTheme)
	// Strip every palette class generically — no per-palette list to keep in
	// sync, and stale classes from older versions get cleaned up too.
	for (const cls of [...root.classList]) {
		if (cls.startsWith("theme-")) root.classList.remove(cls)
	}
	if (palette !== "mono") {
		root.classList.add(`theme-${palette}`)
	}
	// `data-icon-style` drives the grayscale rule in `@hoardodile/ui/theme.css`;
	// `linear` only matters to the host's own icon registry.
	root.dataset.iconStyle = iconStyle
}

// The plugin bundle's theme.css only defines a `--font-sans` fallback;
// nothing in it consumes `--font-app`, so the SDK installs this rule once
// to make the document actually pick up the inherited font.
const FONT_STYLE_ID = "plugin-host-font"

/**
 * Applies the host app font to the iframe document: injects each preset
 * stylesheet once (idempotent per path — they are absolute `/fonts/...`
 * URLs statically served by the host, which the sandboxed iframe can
 * load), then points `--font-app` at the family stack. An empty family
 * means the plugin opted out of font inheritance: the variable is
 * removed and the document falls back to the plugin's own `--font-sans`.
 */
export function applyFonts(family: string, cssPaths: readonly string[]): void {
	for (const path of cssPaths) {
		const selector = `link[rel="stylesheet"][href="${path}"]`
		if (document.head.querySelector(selector) !== null) continue
		const link = document.createElement("link")
		link.rel = "stylesheet"
		link.href = path
		document.head.appendChild(link)
	}

	const root = document.documentElement
	if (family === "") {
		root.style.removeProperty("--font-app")
	} else {
		root.style.setProperty("--font-app", family)
	}

	if (document.getElementById(FONT_STYLE_ID) === null) {
		const style = document.createElement("style")
		style.id = FONT_STYLE_ID
		style.textContent = "html{font-family:var(--font-app,var(--font-sans))}"
		document.head.appendChild(style)
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}
