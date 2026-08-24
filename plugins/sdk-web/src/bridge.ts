import type {
	Host,
	HostMessage,
	HostPushes,
	PluginMessage,
	PluginRequests,
	PluginSubscribe,
	RequestInput,
	RequestOutput,
} from "./protocol.ts"
import { PROTOCOL_VERSION, pluginRequestTimeouts } from "./protocol.ts"

// ── Host bridge ──────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 10_000

let nextId = 1
let hostBridge: Host | undefined

/**
 * Narrow an unknown value to a plain record. Handy for decoding
 * plugin-defined payloads (e.g. anchor data) without assertion casts.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isValidHostMessage(msg: unknown): msg is HostMessage {
	return isRecord(msg) && "type" in msg
}

/**
 * Lazily create (and then reuse) the singleton postMessage bridge to the
 * host parent window: request/response with a 10s timeout plus push
 * subscriptions. Only the host window may drive the bridge — messages
 * from any other source are ignored. Called automatically by
 * {@link createIframeHostAPI}; you only need this when talking to the
 * host outside the plugin API surface.
 */
export function ensureHostBridge(): Host {
	if (hostBridge !== undefined) return hostBridge

	const pending = new Map<
		number,
		{
			resolve(value: unknown): void
			reject(reason: Error): void
			timeoutId: ReturnType<typeof setTimeout>
		}
	>()
	const subscribers = new Map<string, Set<(data: unknown) => void>>()

	window.addEventListener(
		"message",
		function handleMessage(event: MessageEvent) {
			// Only the host (parent window) may drive this bridge; any
			// other window that obtains a reference to this frame must
			// not be able to inject fake responses or pushes.
			//
			// jsdom delivers same-window postMessage with `source: null`
			// (real browsers always carry the posting window). A null
			// source is only trusted when this frame IS its own parent —
			// the jsdom/test embedding — which cannot happen for a real
			// sandboxed iframe, where `window.parent !== window`.
			const selfEmbedded = window.parent === window
			if (
				event.source !== window.parent &&
				!(selfEmbedded && event.source === null)
			) {
				return
			}
			const msg = event.data
			if (!isValidHostMessage(msg)) return

			if (msg.type === "response") {
				const entry = pending.get(msg.id)
				if (entry === undefined) return
				pending.delete(msg.id)
				clearTimeout(entry.timeoutId)
				if (msg.ok) {
					entry.resolve(msg.data)
				} else {
					const err = new Error(msg.error ?? "Unknown error")
					// Preserve the machine-readable code (e.g. the asset
					// DENIED/UNAVAILABLE/POLICY vocabulary) so plugin code
					// can branch on `err.name` across the bridge.
					const code = msg.errorCode ?? msg.errorName
					if (code !== undefined && code.length > 0) {
						err.name = code
					}
					entry.reject(err)
				}
			} else if (msg.type === "push") {
				const handlers = subscribers.get(msg.key)
				if (handlers !== undefined) {
					for (const handler of handlers) {
						handler(msg.data)
					}
				}
			}
		},
	)

	function request<K extends keyof PluginRequests>(
		resId: string | undefined,
		method: K,
		...args: RequestInput<K> extends void ? [] : [RequestInput<K>]
	): Promise<RequestOutput<K>> {
		const id = nextId++
		const input = args[0] as RequestInput<K> | undefined
		// Per-method timeouts are declared in the protocol meta
		// (`pluginRequestTimeouts`, e.g. downloads waiting on the consent
		// dialog) — callers never pass one.
		const timeoutMs =
			(pluginRequestTimeouts as Partial<Record<string, number>>)[method] ??
			REQUEST_TIMEOUT_MS
		const params = input
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				pending.delete(id)
				reject(new Error(`Request timed out: ${String(method)}`))
			}, timeoutMs)
			pending.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timeoutId,
			})
			const message: PluginMessage = {
				type: "request",
				id,
				method: method as string,
				params,
				proto: PROTOCOL_VERSION,
				resId,
			}
			window.parent.postMessage(message, "*")
		})
	}

	function subscribe<K extends keyof HostPushes>(
		key: K,
		handler: (data: HostPushes[K]) => void,
	): () => void {
		const keyString = key as string
		let handlers = subscribers.get(keyString)
		if (handlers === undefined) {
			handlers = new Set()
			subscribers.set(keyString, handlers)
			const message: PluginSubscribe = {
				type: "subscribe",
				key: keyString,
				proto: PROTOCOL_VERSION,
			}
			window.parent.postMessage(message, "*")
		}
		const wrapped = (data: unknown) => handler(data as HostPushes[K])
		handlers.add(wrapped)
		return function unsubscribe() {
			handlers!.delete(wrapped)
			if (handlers!.size === 0) {
				subscribers.delete(keyString)
			}
		}
	}

	function makeHost(resId: string | undefined): Host {
		return {
			request(method, ...args) {
				return request(resId, method, ...args)
			},
			subscribe,
			withScope: makeHost,
		}
	}

	hostBridge = makeHost(undefined)
	return hostBridge
}
