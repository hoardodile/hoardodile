import { QueryClient } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { channelNames, lockNames } from "@/lib/keys"
import { connectEventSource, type SseStreamEvent, streamSse } from "./sse"

type FetchEventSourceHandlers = {
	readonly signal?: AbortSignal
	onopen?: (response: Response) => Promise<void>
	onmessage?: (msg: { data: string }) => void
	onerror?: (err: unknown) => number | undefined
	onclose?: () => void
}

const fetchEventSourceMock =
	vi.fn<(url: string, opts: FetchEventSourceHandlers) => Promise<void>>()

vi.mock("@microsoft/fetch-event-source", () => ({
	fetchEventSource: (...args: unknown[]) =>
		fetchEventSourceMock(...(args as [string, FetchEventSourceHandlers])),
}))

type BroadcastListener = (event: MessageEvent) => void

class MockBroadcastChannel {
	static readonly instances = new Map<string, Set<MockBroadcastChannel>>()

	readonly name: string
	readonly listeners = new Set<BroadcastListener>()

	constructor(name: string) {
		this.name = name
		let set = MockBroadcastChannel.instances.get(name)
		if (set === undefined) {
			set = new Set()
			MockBroadcastChannel.instances.set(name, set)
		}
		set.add(this)
	}

	addEventListener(_type: "message", listener: BroadcastListener): void {
		this.listeners.add(listener)
	}

	removeEventListener(_type: "message", listener: BroadcastListener): void {
		this.listeners.delete(listener)
	}

	postMessage(data: unknown): void {
		const peers = MockBroadcastChannel.instances.get(this.name)
		if (peers === undefined) return
		for (const peer of peers) {
			if (peer === this) continue
			for (const listener of peer.listeners) {
				listener({ data } as MessageEvent)
			}
		}
	}

	close(): void {
		const peers = MockBroadcastChannel.instances.get(this.name)
		peers?.delete(this)
	}

	static reset(): void {
		MockBroadcastChannel.instances.clear()
	}
}

type LockCallback = () => void | Promise<void>

class MockLockManager {
	private holder: string | undefined
	private readonly waiters: Array<{
		name: string
		callback: LockCallback
		resolve: () => void
	}> = []

	async request(
		name: string,
		_options: { mode: string },
		callback: LockCallback,
	): Promise<void> {
		if (this.holder === undefined) {
			this.holder = name
			try {
				await callback()
			} finally {
				this.holder = undefined
				this.flushWaiters()
			}
			return
		}

		await new Promise<void>((resolve) => {
			this.waiters.push({ name, callback, resolve })
		})
	}

	private flushWaiters(): void {
		if (this.holder !== undefined) return
		const next = this.waiters.shift()
		if (next === undefined) return
		void this.request(next.name, { mode: "exclusive" }, next.callback).then(
			() => {
				next.resolve()
			},
		)
	}

	reset(): void {
		this.holder = undefined
		this.waiters.length = 0
	}
}

describe("connectEventSource", () => {
	let queryClient: QueryClient
	let lockManager: MockLockManager
	let sseOpen: FetchEventSourceHandlers | undefined

	beforeEach(() => {
		MockBroadcastChannel.reset()
		lockManager = new MockLockManager()
		queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		})
		delete document.documentElement.dataset.sseConnected
		fetchEventSourceMock.mockReset()
		fetchEventSourceMock.mockImplementation(async (_url, opts) => {
			sseOpen = opts
			await opts.onopen?.(new Response(null, { status: 200 }))
			await new Promise<void>((resolve) => {
				if (opts.signal?.aborted === true) {
					resolve()
					return
				}
				opts.signal?.addEventListener("abort", () => resolve(), { once: true })
			})
		})

		vi.stubGlobal("BroadcastChannel", MockBroadcastChannel)
		vi.stubGlobal("navigator", {
			locks: lockManager,
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		sseOpen = undefined
	})

	it("elects a single SSE leader across two tabs", async () => {
		const stopA = connectEventSource(queryClient)
		await vi.waitFor(() => {
			expect(fetchEventSourceMock).toHaveBeenCalledTimes(1)
		})

		const stopB = connectEventSource(queryClient)
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(fetchEventSourceMock).toHaveBeenCalledTimes(1)

		stopA()
		await vi.waitFor(() => {
			expect(fetchEventSourceMock).toHaveBeenCalledTimes(2)
		})

		stopB()
	})

	it("forwards leader business events to follower tabs", async () => {
		const onEventB = vi.fn()
		const stopA = connectEventSource(queryClient)
		await vi.waitFor(() => {
			expect(fetchEventSourceMock).toHaveBeenCalledTimes(1)
		})

		const stopB = connectEventSource(queryClient, { onEvent: onEventB })
		await new Promise((resolve) => setTimeout(resolve, 10))

		const payload = {
			type: "resourceMetaUpdated" as const,
			id: "res-1",
			meta: {},
		}
		sseOpen?.onmessage?.({ data: JSON.stringify(payload) })

		expect(onEventB).toHaveBeenCalledWith(payload)

		stopA()
		stopB()
	})

	it("notifies followers when the leader reconnects", async () => {
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")
		const stopA = connectEventSource(queryClient)
		await vi.waitFor(() => {
			expect(document.documentElement.dataset.sseConnected).toBe("1")
		})

		connectEventSource(queryClient)
		await new Promise((resolve) => setTimeout(resolve, 10))
		invalidateSpy.mockClear()

		await sseOpen?.onopen?.(new Response(null, { status: 200 }))

		await vi.waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalled()
		})

		stopA()
	})

	it("falls back to per-tab SSE when Web Locks are unavailable", async () => {
		vi.stubGlobal("navigator", {})
		fetchEventSourceMock.mockReset()
		fetchEventSourceMock.mockImplementation(async () => {
			await new Promise(() => {})
		})

		connectEventSource(queryClient)
		connectEventSource(queryClient)
		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(fetchEventSourceMock).toHaveBeenCalledTimes(2)
	})

	it("uses the shared lock and channel names", () => {
		expect(lockNames.sse).toBe("hoardodile-sse")
		expect(channelNames.sseEvents).toBe("hoardodile-sse-events")
	})
})

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder()
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk))
			}
			controller.close()
		},
	})
}

describe("streamSse", () => {
	it("parses event frames delimited by blank lines", async () => {
		const events: SseStreamEvent[] = []
		await streamSse(
			streamFromChunks([
				'event: phase\ndata: {"phase":"resources","total":2}\n\n',
				'event: progress\ndata: {"phase":"resources","current":1,"total":2}\n\n',
			]),
			(event) => {
				events.push(event)
			},
		)

		expect(events).toEqual([
			{ event: "phase", data: { phase: "resources", total: 2 } },
			{ event: "progress", data: { phase: "resources", current: 1, total: 2 } },
		])
	})

	it("handles frames split across chunks", async () => {
		const events: SseStreamEvent[] = []
		await streamSse(
			streamFromChunks(["event: ph", "ase\nda", 'ta: {"a":1}\n', "\n"]),
			(event) => {
				events.push(event)
			},
		)

		expect(events).toEqual([{ event: "phase", data: { a: 1 } }])
	})

	it("ignores comment lines and flushes a trailing frame at EOF", async () => {
		const events: SseStreamEvent[] = []
		await streamSse(
			streamFromChunks([": heartbeat\n\n", 'data: {"last":true}']),
			(event) => {
				events.push(event)
			},
		)

		expect(events).toEqual([{ event: "", data: { last: true } }])
	})
})
