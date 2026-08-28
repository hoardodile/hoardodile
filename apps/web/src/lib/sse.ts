import type {
	PluginDownloadRequestedEvent,
	PluginDownloadResolvedEvent,
	ResourceMetaUpdatedEvent,
	StorageContextReloadedEvent,
} from "@hoardodile/schemas"
import { fetchEventSource } from "@microsoft/fetch-event-source"
import type { QueryClient } from "@tanstack/react-query"
import { channelNames, lockNames } from "@/lib/keys"
import { apiPaths } from "@/lib/paths"

const INITIAL_RECONNECT_MS = 1_000
const MAX_RECONNECT_MS = 30_000
const LEADER_HEARTBEAT_MS = 5_000

export type SseEvent =
	| ResourceMetaUpdatedEvent
	| StorageContextReloadedEvent
	| PluginDownloadRequestedEvent
	| PluginDownloadResolvedEvent

type SseBroadcastMessage =
	| { readonly type: "connected"; readonly reconnect: boolean }
	| { readonly type: "disconnected" }
	| { readonly type: "event"; readonly payload: SseEvent }
	| { readonly type: "leader-heartbeat" }

class RetriableSseError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "RetriableSseError"
	}
}

export type SseStreamEvent = {
	readonly event: string
	readonly data: unknown
}

/**
 * Consume a Server-Sent Events stream (typically a fetch `Response.body`)
 * frame by frame. Frames are delimited by blank lines; each frame's `event:`
 * and `data:` lines are combined and delivered to `onEvent` with the data
 * parsed as JSON. Handles chunk boundaries arbitrarily (a frame may be
 * split across reads). The reader lock is always released.
 */
export async function streamSse(
	body: ReadableStream<Uint8Array>,
	onEvent: (event: SseStreamEvent) => void,
): Promise<void> {
	const reader = body.getReader()
	const decoder = new TextDecoder()
	let buffer = ""
	let eventType = ""
	let dataLines: string[] = []

	function flushFrame(): void {
		if (dataLines.length > 0) {
			const data: unknown = JSON.parse(dataLines.join("\n"))
			onEvent({ event: eventType, data })
		}
		eventType = ""
		dataLines = []
	}

	function processLine(rawLine: string): void {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
		if (line === "") {
			flushFrame()
		} else if (line.startsWith("event:")) {
			eventType = line.slice("event:".length).trimStart()
		} else if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trimStart())
		}
	}

	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split("\n")
			buffer = lines.pop() ?? ""

			for (const line of lines) {
				processLine(line)
			}
		}
		// A final frame may end at EOF without a trailing newline.
		if (buffer.length > 0) {
			processLine(buffer)
		}
		flushFrame()
	} finally {
		reader.releaseLock()
	}
}

export type ConnectEventSourceOptions = {
	readonly onEvent?: (event: SseEvent) => void
	/**
	 * Fired on every established stream — the first successful connect
	 * and each reconnect — so listeners rehydrate ephemeral server state
	 * that broadcasts may have missed while the connection was down or
	 * not yet up, e.g. pending plugin download consent tickets
	 * (`pluginAsset.listPending`). Idempotent by contract.
	 */
	readonly onReconnect?: () => void
}

function supportsWebLocks(): boolean {
	return typeof navigator.locks?.request === "function"
}

function parseBusinessEvent(data: string): SseEvent | undefined {
	if (data.trim().length === 0) return undefined
	try {
		const parsed = JSON.parse(data) as unknown
		if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
			return parsed as SseEvent
		}
	} catch {
		// Not a JSON business event — ignore (heartbeats, comments, etc.)
	}
	return undefined
}

/**
 * Maintain a persistent SSE connection to `/api/events`. The server emits
 * heartbeats and optional business events; the connection is used as a
 * liveness signal so the client can invalidate queries after a reconnect,
 * and as a channel for fine-grained resource updates.
 *
 * Only one browser tab per origin holds the real SSE connection (Web Locks
 * leader); other tabs receive events via {@link BroadcastChannel} so the
 * shared HTTP/1.1 connection pool is not exhausted by N idle SSE streams.
 *
 * `document.documentElement.dataset.sseConnected` is set to `"1"` while
 * connected and removed on error/close (used by Playwright assertions).
 *
 * @returns A cleanup function that stops the connection and cancels any
 *   pending reconnect timer.
 */
export function connectEventSource(
	queryClient: QueryClient,
	options?: ConnectEventSourceOptions,
): () => void {
	const controller = new AbortController()
	let stopped = false
	let hasConnectedBefore = false

	const channel = new BroadcastChannel(channelNames.sseEvents)

	function broadcast(message: SseBroadcastMessage): void {
		channel.postMessage(message)
	}

	function handleBroadcastMessage(
		event: MessageEvent<SseBroadcastMessage>,
	): void {
		const msg = event.data
		if (msg === undefined || msg === null || typeof msg !== "object") return
		switch (msg.type) {
			case "connected":
				document.documentElement.dataset.sseConnected = "1"
				// Rehydrate on every open, not only reconnects: a ticket
				// created before the first successful connect (server warm
				// while the stream was retrying) must show up too.
				if (msg.reconnect) {
					void queryClient.invalidateQueries()
				}
				options?.onReconnect?.()
				break
			case "disconnected":
				delete document.documentElement.dataset.sseConnected
				break
			case "event":
				options?.onEvent?.(msg.payload)
				break
			case "leader-heartbeat":
				break
		}
	}

	channel.addEventListener("message", handleBroadcastMessage)

	async function runLeaderSse(isLeader: boolean): Promise<void> {
		let reconnectMs = INITIAL_RECONNECT_MS
		let heartbeatId: ReturnType<typeof setInterval> | undefined

		if (isLeader) {
			heartbeatId = setInterval(() => {
				broadcast({ type: "leader-heartbeat" })
			}, LEADER_HEARTBEAT_MS)
		}

		try {
			await fetchEventSource(apiPaths.events(), {
				credentials: "include",
				signal: controller.signal,
				openWhenHidden: true,
				onopen: async (response) => {
					if (!response.ok) {
						throw new RetriableSseError(`SSE failed: ${response.status}`)
					}
					reconnectMs = INITIAL_RECONNECT_MS
					const reconnect = hasConnectedBefore
					hasConnectedBefore = true
					document.documentElement.dataset.sseConnected = "1"
					if (isLeader) {
						broadcast({ type: "connected", reconnect })
					}
					// Rehydrate on every open (initial included) so ephemeral
					// state whose broadcast was missed while the stream was
					// down — or before the first connect — reappears.
					if (reconnect) {
						void queryClient.invalidateQueries()
					}
					options?.onReconnect?.()
				},
				onmessage: (msg) => {
					if (!msg.data) return
					const parsed = parseBusinessEvent(msg.data)
					if (parsed === undefined) return
					options?.onEvent?.(parsed)
					if (isLeader) {
						broadcast({ type: "event", payload: parsed })
					}
				},
				onerror: (err) => {
					const delay = reconnectMs
					delete document.documentElement.dataset.sseConnected
					if (isLeader) {
						broadcast({ type: "disconnected" })
					}
					reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_MS)
					if (err instanceof Error && err.name === "AbortError") throw err
					return delay
				},
				onclose: () => {
					delete document.documentElement.dataset.sseConnected
					if (isLeader) {
						broadcast({ type: "disconnected" })
					}
					throw new RetriableSseError("SSE closed")
				},
			})
		} finally {
			if (heartbeatId !== undefined) {
				clearInterval(heartbeatId)
			}
		}
	}

	void (async function startCoordinator() {
		if (!supportsWebLocks()) {
			try {
				await runLeaderSse(true)
			} catch {
				// Abort or non-retriable failure — dataset already cleared.
			}
			return
		}

		while (!stopped && !controller.signal.aborted) {
			try {
				await navigator.locks.request(
					lockNames.sse,
					{ mode: "exclusive" },
					async () => {
						if (stopped || controller.signal.aborted) return
						try {
							await runLeaderSse(true)
						} catch {
							// fetch-event-source aborted or exhausted retries.
						}
					},
				)
			} catch {
				break
			}
			if (stopped || controller.signal.aborted) break
		}
	})()

	return function stop(): void {
		stopped = true
		controller.abort()
		channel.removeEventListener("message", handleBroadcastMessage)
		channel.close()
		delete document.documentElement.dataset.sseConnected
	}
}
