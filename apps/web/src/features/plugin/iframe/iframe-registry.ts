import type { HostPush } from "@hoardodile/sdk-web"
import { postToIframe } from "./transport"

// Registry: tracks which iframe window is bound to which plugin/resource,
// provides the scoped broadcasts (all / per-resource / subscribers), and
// authenticates inbound plugin messages (resolvePluginMessageSource).

export type IframeRecord = {
	pluginId: string
	resId: string
}

/**
 * What each iframe is bound to. A binding lives until the next
 * registration or the iframe's destruction — `release()` deliberately
 * leaves it in place so requests issued before the close (e.g. an
 * unmount cache flush) still resolve to the resource they belong to.
 */
const iframeBySource = new Map<Window, IframeRecord>()
const sourcesByResId = new Map<string, Set<Window>>()
const subscriptionsBySource = new Map<Window, Set<string>>()

export function registerIframe(source: Window, record: IframeRecord): void {
	const prev = iframeBySource.get(source)
	if (prev !== undefined) {
		const prevSources = sourcesByResId.get(prev.resId)
		if (prevSources !== undefined) {
			prevSources.delete(source)
			if (prevSources.size === 0) {
				sourcesByResId.delete(prev.resId)
			}
		}
	}
	iframeBySource.set(source, record)
	let sources = sourcesByResId.get(record.resId)
	if (sources === undefined) {
		sources = new Set()
		sourcesByResId.set(record.resId, sources)
	}
	sources.add(source)
}

export function unregisterIframe(source: Window): void {
	const record = iframeBySource.get(source)
	if (record !== undefined) {
		const sources = sourcesByResId.get(record.resId)
		if (sources !== undefined) {
			sources.delete(source)
			if (sources.size === 0) {
				sourcesByResId.delete(record.resId)
			}
		}
	}
	iframeBySource.delete(source)
	subscriptionsBySource.delete(source)
}

export function getIframeBySource(source: Window): IframeRecord | undefined {
	return iframeBySource.get(source)
}

export function broadcastToResource(resId: string, event: HostPush): void {
	const sources = sourcesByResId.get(resId)
	if (sources === undefined) return
	for (const source of sources) {
		postToIframe(source, event)
	}
}

export function broadcastToAll(
	event: HostPush,
	filter?: (record: IframeRecord) => boolean,
): void {
	for (const [source, record] of iframeBySource) {
		if (filter !== undefined && !filter(record)) continue
		postToIframe(source, event)
	}
}

export function addSubscription(source: Window, key: string): void {
	let keys = subscriptionsBySource.get(source)
	if (keys === undefined) {
		keys = new Set()
		subscriptionsBySource.set(source, keys)
	}
	keys.add(key)
}

export function broadcastToSubscribers(key: string, data?: unknown): void {
	const event: HostPush = { type: "push", key, data }
	for (const [source, keys] of subscriptionsBySource) {
		if (keys.has(key)) {
			postToIframe(source, event)
		}
	}
}

/**
 * `event.source` is typed `Window | MessagePort | ServiceWorker | null`;
 * plugin iframes always post from their contentWindow. Narrow by
 * excluding the port/worker types with instanceof — duck-typing with
 * `in` throws SecurityError on cross-origin Window proxies, and every
 * sandboxed plugin iframe IS cross-origin (opaque origin "null").
 * `instanceof Window` is unusable here because tests register stand-in
 * windows that are not real Window instances.
 */
function isWindowSource(source: MessageEventSource | null): source is Window {
	if (source === null) return false
	if (typeof MessagePort !== "undefined" && source instanceof MessagePort) {
		return false
	}
	if (typeof ServiceWorker !== "undefined" && source instanceof ServiceWorker) {
		return false
	}
	return true
}

/**
 * The single implementation of the inbound-message security checks:
 * the origin must be "null" (sandboxed iframes without
 * allow-same-origin have the opaque origin "null"), the source must be
 * a window, and that window must be a registered iframe. Returns the
 * narrowed source and its binding, or undefined to drop the message.
 */
export function resolvePluginMessageSource(
	event: MessageEvent,
): { readonly source: Window; readonly record: IframeRecord } | undefined {
	if (event.origin !== "null") return undefined
	const source = event.source
	if (!isWindowSource(source)) return undefined
	const record = iframeBySource.get(source)
	if (record === undefined) return undefined
	return { source, record }
}
