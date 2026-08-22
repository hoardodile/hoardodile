import { pluginMethods } from "@hoardodile/sdk-web"
import { afterEach, describe, expect, it, vi } from "vitest"
import { anchorData, requestSchemas } from "./request-schemas.ts"
import type { HostHandlerEntry } from "./router.ts"
import { createHostRouter, defineHandler } from "./router.ts"

type FakeWindow = Window & { postMessage: (...args: unknown[]) => void }

function fakeWindow(): FakeWindow {
	const w = new EventTarget() as unknown as FakeWindow
	w.postMessage = vi.fn() as unknown as (...args: unknown[]) => void
	return w
}

function fakeMessageEvent(data: unknown, source: Window): MessageEvent {
	return new MessageEvent("message", {
		data,
		source,
		origin: "null",
	})
}

function buildRouter(handlers: readonly HostHandlerEntry[] = []) {
	const respond = vi.fn()
	const subscribe = vi.fn()
	const router = createHostRouter(handlers, {
		resolveSource(event) {
			const source = event.source
			if (source === null) return undefined
			return { source, record: { pluginId: "p-1", resId: "r-1" } }
		},
		respond,
		subscribe,
	})
	return { router, respond, subscribe }
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe("createHostRouter", () => {
	it("routes a request to its handler and responds", async () => {
		const { router, respond } = buildRouter([
			defineHandler(pluginMethods.listFiles, async () => ["a.png"]),
		])
		const source = fakeWindow()
		router(
			fakeMessageEvent(
				{ type: "request", id: 1, method: pluginMethods.listFiles },
				source,
			),
		)
		await vi.waitFor(() => expect(respond).toHaveBeenCalled())
		expect(respond).toHaveBeenCalledWith(source, {
			type: "response",
			id: 1,
			ok: true,
			data: ["a.png"],
		})
	})

	it("validates params with the shared schema before the handler", async () => {
		const handler = vi.fn(async () => "ran")
		const { router, respond } = buildRouter([
			defineHandler(
				pluginMethods.readFile,
				requestSchemas[pluginMethods.readFile],
				handler,
			),
		])
		const source = fakeWindow()
		router(
			fakeMessageEvent(
				{ type: "request", id: 1, method: pluginMethods.readFile, params: {} },
				source,
			),
		)
		await vi.waitFor(() => expect(respond).toHaveBeenCalled())
		expect(handler).not.toHaveBeenCalled()
		expect(respond).toHaveBeenCalledWith(source, {
			type: "response",
			id: 1,
			ok: false,
			error: expect.stringContaining("Invalid params"),
		})
	})

	it("passes validated params to the handler", async () => {
		const seen: unknown[] = []
		const { router } = buildRouter([
			defineHandler(
				pluginMethods.createMessage,
				requestSchemas[pluginMethods.createMessage],
				async (_ctx, params) => {
					seen.push(params)
					return "ok"
				},
			),
		])
		const source = fakeWindow()
		router(
			fakeMessageEvent(
				{
					type: "request",
					id: 1,
					method: pluginMethods.createMessage,
					params: { body: "hi", anchor: { data: { page: 3 } } },
				},
				source,
			),
		)
		await vi.waitFor(() => expect(seen).toHaveLength(1))
		expect(seen[0]).toEqual({ body: "hi", anchor: { data: { page: 3 } } })
	})

	it("drops a stale resId stamp without invoking the handler", async () => {
		const handler = vi.fn(async () => "ran")
		const { router, respond } = buildRouter([
			defineHandler(
				pluginMethods.readFile,
				requestSchemas[pluginMethods.readFile],
				handler,
			),
		])
		const source = fakeWindow()
		router(
			fakeMessageEvent(
				{
					type: "request",
					id: 1,
					method: pluginMethods.readFile,
					params: { path: "a.png" },
					resId: "r-foreign",
				},
				source,
			),
		)
		await vi.waitFor(() => expect(respond).toHaveBeenCalled())
		expect(handler).not.toHaveBeenCalled()
		expect(respond).toHaveBeenCalledWith(source, {
			type: "response",
			id: 1,
			ok: true,
		})
	})

	it("rejects unknown methods with an error response", async () => {
		const { router, respond } = buildRouter()
		const source = fakeWindow()
		router(fakeMessageEvent({ type: "request", id: 1, method: "nope" }, source))
		await vi.waitFor(() => expect(respond).toHaveBeenCalled())
		expect(respond).toHaveBeenCalledWith(source, {
			type: "response",
			id: 1,
			ok: false,
			error: "Unknown method: nope",
		})
	})

	it("records subscriptions without responding", async () => {
		const { router, respond, subscribe } = buildRouter()
		const source = fakeWindow()
		router(fakeMessageEvent({ type: "subscribe", key: "themeChanged" }, source))
		expect(subscribe).toHaveBeenCalledWith(source, "themeChanged")
		expect(respond).not.toHaveBeenCalled()
	})

	it("drops messages from unresolved sources", async () => {
		const respond = vi.fn()
		const router = createHostRouter([], {
			resolveSource: () => undefined,
			respond,
			subscribe: () => {},
		})
		router(
			fakeMessageEvent(
				{ type: "request", id: 1, method: pluginMethods.listFiles },
				fakeWindow(),
			),
		)
		expect(respond).not.toHaveBeenCalled()
	})

	it("warns once per source about a missing protocol stamp", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const { router, respond } = buildRouter()
		const source = fakeWindow()
		const event = (data: unknown) => fakeMessageEvent(data, source)
		router(event({ type: "subscribe", key: "themeChanged" }))
		router(event({ type: "subscribe", key: "visibility" }))
		expect(warnSpy).toHaveBeenCalledTimes(1)
		expect(warnSpy.mock.calls[0]?.[0]).toContain("did not stamp")
		expect(respond).not.toHaveBeenCalled()
	})

	it("warns once per source about a protocol version mismatch", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const { router, respond } = buildRouter()
		const source = fakeWindow()
		const event = (data: unknown) => fakeMessageEvent(data, source)
		router(event({ type: "subscribe", key: "themeChanged", proto: 999 }))
		router(event({ type: "subscribe", key: "visibility", proto: 999 }))
		expect(warnSpy).toHaveBeenCalledTimes(1)
		expect(warnSpy.mock.calls[0]?.[0]).toContain("protocol version 999")
		expect(respond).not.toHaveBeenCalled()
	})

	it("does not warn for matching protocol stamps", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const { router } = buildRouter()
		const source = fakeWindow()
		router(
			fakeMessageEvent(
				{ type: "subscribe", key: "themeChanged", proto: 1 },
				source,
			),
		)
		expect(warnSpy).not.toHaveBeenCalled()
	})
})

describe("requestSchemas", () => {
	it("anchorData accepts only the plugin location payload", () => {
		expect(anchorData.safeParse({ data: { page: 1 } }).success).toBe(true)
		expect(anchorData.safeParse({ data: 1 }).success).toBe(true)
		expect(anchorData.safeParse({}).success).toBe(true)
		// The resource id is host state — a plugin sending it is rejected.
		expect(anchorData.safeParse({ resId: "r-1" }).success).toBe(false)
	})
})
