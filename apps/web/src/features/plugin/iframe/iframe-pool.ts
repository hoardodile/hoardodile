import type { PluginIframeContext } from "@hoardodile/sdk-web"
import { apiPaths } from "@/lib/paths"
import {
	registerIframe,
	resolvePluginMessageSource,
	unregisterIframe,
} from "./iframe-registry"
import { createTransport, type PluginIframeTransport } from "./transport"

// Pool: owns iframe elements (primary + capped ephemerals, LRU eviction,
// idle-TTL teardown, assetVersion reload) and hands out claim handles
// with release/postContext. Transports live in transport.ts; the
// window↔plugin/resource registry and inbound message-source validation
// live in iframe-registry.ts.

const EPHEMERAL_CAP_PER_PLUGIN = 2

/**
 * Idle entries — primary included — are destroyed after this long
 * without a claim. The pool exists to make near-term reuse fast, not to
 * keep plugin documents alive forever: a dozen idle iframes (one
 * primary + two ephemerals per plugin) hold real memory and media
 * contexts. Rebuilding after teardown only costs a locally cached
 * bundle load.
 */
const IDLE_TTL_MS = 60_000

/**
 * Grace period after a slot claim: if no "contextPainted" ack arrives by
 * then, the plugin was built with an SDK that predates the ack protocol —
 * treat the claim as ready anyway (the pre-ack behavior).
 */
const READY_FALLBACK_MS = 300

export type PoolClaimedEntry = {
	readonly iframe: HTMLIFrameElement
	readonly release: () => void
	readonly postContext: (ctx: PluginIframeContext) => void
	readonly setVisibility: (visible: boolean) => void
	readonly onLoaded: (cb: () => void) => () => void
	readonly whenLoaded: () => Promise<void>
	/**
	 * Fires once this claim is ready to be seen: the plugin has painted
	 * the first frame of the pushed context (see
	 * {@link PluginContextPainted}), or the legacy-SDK fallback elapsed.
	 * Fires at most once; a callback subscribed after the fact is invoked
	 * immediately.
	 */
	readonly onReady: (cb: () => void) => () => void
	/**
	 * Set when the claim is primed: the pooled entry already painted (and
	 * acked) exactly this resId, so readiness fired upfront without an ack
	 * wait or fallback timer. Undefined for a normal claim.
	 */
	readonly primedResId: string | undefined
}

type PoolEntry = {
	readonly id: number
	readonly pluginId: string
	readonly iframe: HTMLIFrameElement
	readonly isPrimary: boolean
	readonly transport: PluginIframeTransport
	readonly contextPaintedListeners: Set<(resId: string) => void>
	claimId: number | undefined
	lastReleased: number
	loaded: boolean
	/**
	 * The resId of the last context this entry acknowledged painting.
	 * Survives release: a later claim for the same resId is "primed" and
	 * skips the ack wait entirely. Invalidated by any context push,
	 * assetVersion reload, or destruction.
	 */
	lastAckedResId?: string
	/** Fingerprint the iframe's versioned URL was built with. */
	assetVersion?: string
}

const entries = new Map<number, PoolEntry>()
const byPlugin = new Map<string, PoolEntry[]>()
/**
 * Reverse lookup from an iframe window to its pool entry, so
 * "contextPainted" acks route to the owning entry without scanning the
 * pool. Written on iframe load (alongside the registry binding) and
 * dropped on entry destruction.
 */
const entryBySource = new Map<Window, PoolEntry>()
let nextEntryId = 1
let nextClaimId = 1
let container: HTMLElement | undefined
let evictTimer: ReturnType<typeof setInterval> | undefined
let ackListener: ((event: MessageEvent) => void) | undefined

/**
 * Routes plugin "contextPainted" acks to the owning entry's listeners.
 * Same security posture as the host message handler: origin/source
 * validation goes through the shared resolvePluginMessageSource.
 */
function handleContextPaintedMessage(event: MessageEvent): void {
	const msg = event.data as { type?: unknown; resId?: unknown } | null
	if (
		msg === null ||
		typeof msg !== "object" ||
		msg.type !== "contextPainted"
	) {
		return
	}
	if (typeof msg.resId !== "string") return
	const resolved = resolvePluginMessageSource(event)
	if (resolved === undefined) return
	const entry = entryBySource.get(resolved.source)
	if (entry === undefined) return
	// Remember what the entry painted so a later claim for the same
	// resId can present immediately (predictive prerender path).
	entry.lastAckedResId = msg.resId
	for (const cb of entry.contextPaintedListeners) {
		cb(msg.resId)
	}
}

function getPluginList(pluginId: string): PoolEntry[] {
	let list = byPlugin.get(pluginId)
	if (list === undefined) {
		list = []
		byPlugin.set(pluginId, list)
	}
	return list
}

function createIframeEntry(
	pluginId: string,
	isPrimary: boolean,
	assetVersion?: string,
): PoolEntry {
	if (container === undefined) {
		throw new Error("PluginIframePool container not mounted")
	}

	const iframe = document.createElement("iframe")
	iframe.sandbox.add("allow-scripts", "allow-forms", "allow-downloads")
	iframe.referrerPolicy = "no-referrer"
	iframe.allowFullscreen = true
	iframe.src = apiPaths.plugins.indexHtml(pluginId, assetVersion)
	iframe.title = `plugin:${pluginId}`
	iframe.style.position = "fixed"
	iframe.style.border = "0"
	iframe.style.display = "none"
	iframe.style.pointerEvents = "auto"
	iframe.style.zIndex = "0"

	const id = nextEntryId++

	function handleLoad() {
		if (entry.loaded) {
			// A second load event means the document reloaded
			// (re-parenting an iframe always reloads it). The fresh
			// document has painted nothing: drop the ack memory so a
			// later claim can't be primed onto a blank page.
			entry.lastAckedResId = undefined
		}
		entry.loaded = true
		const win = iframe.contentWindow
		if (win === null) return
		registerIframe(win, { pluginId, resId: "" })
		entryBySource.set(win, entry)
	}

	function handleError() {
		entry.loaded = true
	}

	iframe.addEventListener("load", handleLoad)
	iframe.addEventListener("error", handleError)
	container.appendChild(iframe)

	const transport = createTransport(iframe)
	const entry: PoolEntry = {
		id,
		pluginId,
		iframe,
		isPrimary,
		transport,
		contextPaintedListeners: new Set(),
		claimId: undefined,
		lastReleased: performance.now(),
		loaded: false,
		assetVersion,
	}

	entries.set(id, entry)
	getPluginList(pluginId).push(entry)
	return entry
}

function findFreeEntry(pluginId: string): PoolEntry | undefined {
	const list = byPlugin.get(pluginId) ?? []
	let best: PoolEntry | undefined
	for (const entry of [...list]) {
		if (!entry.iframe.isConnected) {
			// Detached from the document (the inline preview detaches its
			// iframe on cleanup instead of re-parenting it back): a zombie
			// entry — destroy it and never hand it out.
			destroyEntry(entry)
			continue
		}
		if (entry.claimId !== undefined) continue
		if (best === undefined || entry.lastReleased > best.lastReleased) {
			best = entry
		}
	}
	return best
}

function evictLruIdleEphemeral(pluginId: string): boolean {
	const list = byPlugin.get(pluginId) ?? []
	let worst: PoolEntry | undefined
	for (const entry of list) {
		if (entry.claimId !== undefined || entry.isPrimary) continue
		if (worst === undefined || entry.lastReleased < worst.lastReleased) {
			worst = entry
		}
	}
	if (worst === undefined) return false
	destroyEntry(worst)
	return true
}

/**
 * Periodic teardown of entries the pool no longer wants:
 * - zombie entries whose iframe left the document (inline preview
 *   cleanup) are destroyed on sight;
 * - unclaimed entries idle longer than IDLE_TTL_MS — primary included —
 *   are destroyed so nothing lingers forever;
 * - idle ephemerals beyond EPHEMERAL_CAP_PER_PLUGIN are destroyed,
 *   oldest-released first.
 */
function runEviction(): void {
	const now = performance.now()
	for (const list of [...byPlugin.values()]) {
		const idle = list.filter((e) => e.claimId === undefined)
		const survivors: PoolEntry[] = []
		for (const entry of idle) {
			if (!entry.iframe.isConnected || now - entry.lastReleased > IDLE_TTL_MS) {
				destroyEntry(entry)
			} else {
				survivors.push(entry)
			}
		}
		const idleEphemerals = survivors
			.filter((e) => !e.isPrimary)
			.sort((a, b) => a.lastReleased - b.lastReleased)
		const excess = idleEphemerals.length - EPHEMERAL_CAP_PER_PLUGIN
		if (excess <= 0) continue
		for (const entry of idleEphemerals.slice(0, excess)) {
			destroyEntry(entry)
		}
	}
}

function destroyEntry(entry: PoolEntry): void {
	entry.transport.dispose()
	entry.contextPaintedListeners.clear()
	entry.lastAckedResId = undefined
	const win = entry.iframe.contentWindow
	if (win !== null) {
		unregisterIframe(win)
		entryBySource.delete(win)
	}
	entry.iframe.remove()
	entries.delete(entry.id)
	const list = byPlugin.get(entry.pluginId)
	if (list !== undefined) {
		const idx = list.indexOf(entry)
		if (idx >= 0) list.splice(idx, 1)
		if (list.length === 0) byPlugin.delete(entry.pluginId)
	}
}

export function setPoolContainer(el: HTMLElement | undefined): void {
	container = el
	if (evictTimer !== undefined) {
		clearInterval(evictTimer)
		evictTimer = undefined
	}
	if (ackListener !== undefined) {
		window.removeEventListener("message", ackListener)
		ackListener = undefined
	}
	if (el !== undefined) {
		evictTimer = setInterval(runEviction, 5_000)
		ackListener = handleContextPaintedMessage
		window.addEventListener("message", ackListener)
	}
}

export function claim(opts: {
	pluginId: string
	assetVersion?: string
	/**
	 * The resId the caller intends to display. When the chosen entry
	 * already acked painting this exact resId (predictive prerender),
	 * the claim is primed: readiness is immediate.
	 */
	resId?: string
	/**
	 * Overrides the legacy-SDK readiness fallback. Prerender claims pass
	 * a much longer window: they have no user-facing deadline, and a
	 * hidden iframe's rAF may be throttled (~1fps observed), so the real
	 * ack needs seconds — the 300ms user-facing fallback would fire
	 * first and park the entry unprimed, defeating the prerender.
	 */
	ackTimeoutMs?: number
}): PoolClaimedEntry {
	const { pluginId, assetVersion, resId, ackTimeoutMs } = opts

	let entry = findFreeEntry(pluginId)
	if (entry === undefined) {
		const list = getPluginList(pluginId)
		const hasPrimary = list.some((e) => e.isPrimary)
		const isPrimary = !hasPrimary
		if (!isPrimary) {
			const ephemerals = list.filter((e) => !e.isPrimary)
			if (ephemerals.length >= EPHEMERAL_CAP_PER_PLUGIN) {
				evictLruIdleEphemeral(pluginId)
			}
		}
		entry = createIframeEntry(pluginId, isPrimary, assetVersion)
	} else if (assetVersion !== entry.assetVersion) {
		// The plugin's assets changed since this entry was built —
		// reload from the re-versioned URL so the year-long cache is
		// bypassed only when the fingerprint actually moved. The
		// reloaded document has painted nothing: drop the ack memory.
		entry.loaded = false
		entry.lastAckedResId = undefined
		entry.assetVersion = assetVersion
		entry.iframe.src = apiPaths.plugins.indexHtml(pluginId, assetVersion)
	}
	// Same fingerprint: keep the loaded document untouched. The incoming
	// context push re-mounts the plugin tree onto the new resource (the
	// same mechanism as switching resId inside one dialog), so an idle
	// plugin swaps in without a navigation or a loading phase.

	const claimId = nextClaimId++
	entry.claimId = claimId
	const claimed = entry

	// Primed claim: the entry already painted and acked exactly this
	// resId (a prerender ran the full pipeline earlier), so the context
	// on screen is already correct and readiness is immediate.
	const primed = resId !== undefined && claimed.lastAckedResId === resId

	// Readiness: fires once, when the plugin acknowledges the first
	// painted frame of this claim's context — or when the legacy-SDK
	// fallback elapses (older builds never ack). A primed claim is ready
	// upfront: no ack to wait for, no fallback timer to arm.
	const readyListeners = new Set<() => void>()
	let ready = primed
	function fireReady(): void {
		if (ready) return
		ready = true
		if (fallbackTimer !== undefined) clearTimeout(fallbackTimer)
		for (const cb of readyListeners) {
			cb()
		}
	}
	const fallbackTimer = primed
		? undefined
		: setTimeout(fireReady, ackTimeoutMs ?? READY_FALLBACK_MS)
	function onPainted(): void {
		if (claimed.claimId !== claimId) return
		fireReady()
	}
	if (!primed) {
		claimed.contextPaintedListeners.add(onPainted)
	}

	return {
		iframe: claimed.iframe,
		primedResId: primed ? resId : undefined,
		release() {
			if (claimed.claimId !== claimId) return
			claimed.transport.setVisibility(false)
			claimed.claimId = undefined
			claimed.lastReleased = performance.now()
			claimed.iframe.style.display = "none"
			// No-op for primed claims: the listener was never added and
			// the timer never armed.
			claimed.contextPaintedListeners.delete(onPainted)
			if (fallbackTimer !== undefined) clearTimeout(fallbackTimer)
		},
		postContext(ctx) {
			if (claimed.claimId !== claimId) return
			// A new context invalidates whatever the entry painted before
			// until its own ack arrives.
			claimed.lastAckedResId = undefined
			claimed.transport.pushContext(ctx)
			const win = claimed.iframe.contentWindow
			if (win !== null) {
				registerIframe(win, { pluginId: ctx.pluginId, resId: ctx.resId })
			}
		},
		setVisibility(visible) {
			if (claimed.claimId !== claimId) return
			claimed.transport.setVisibility(visible)
		},
		onLoaded(cb) {
			if (claimed.loaded) {
				cb()
				return () => {}
			}
			function handler() {
				cb()
			}
			claimed.iframe.addEventListener("load", handler)
			return () => claimed.iframe.removeEventListener("load", handler)
		},
		whenLoaded() {
			if (claimed.loaded) return Promise.resolve()
			return new Promise<void>((resolve) => {
				function handler() {
					resolve()
					claimed.iframe.removeEventListener("load", handler)
				}
				claimed.iframe.addEventListener("load", handler)
			})
		},
		onReady(cb) {
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
