import type { PluginRequest } from "@hoardodile/sdk-web"
import { pluginMethods } from "@hoardodile/sdk-web"
import { describe, expect, it, vi } from "vitest"
import { defineHandler } from "./handlers/registry"
import { createHostMessageHandler } from "./host-message-handler"
import { registerIframe, unregisterIframe } from "./iframe-registry"

type FakeWindow = Window & { postMessage: (...args: unknown[]) => void }

function fakeWindow(): FakeWindow {
	const w = new EventTarget() as unknown as FakeWindow
	w.postMessage = vi.fn() as unknown as (...args: unknown[]) => void
	return w
}

function fakeMessageEvent(data: PluginRequest, source: Window): MessageEvent {
	return new MessageEvent("message", { data, source, origin: "null" })
}

function buildHandlers() {
	return [
		defineHandler(
			pluginMethods.readFile,
			async (ctx) => new ArrayBuffer(4 + ctx.resId.length),
		),
		defineHandler(pluginMethods.listFiles, async () => [{ filename: "a.png" }]),
		defineHandler(pluginMethods.listMessages, async () => []),
		defineHandler(pluginMethods.createMessage, async () => ({
			id: "c-1",
			body: "ok",
		})),
		defineHandler(pluginMethods.listDanmaku, async () => []),
		defineHandler(pluginMethods.createDanmaku, async () => ({
			id: "d-1",
			text: "hi",
		})),
		defineHandler(pluginMethods.setPref, async () => undefined),
		defineHandler(pluginMethods.setCache, async () => undefined),
		defineHandler(pluginMethods.invalidate, async () => undefined),
	] as const
}

describe("createHostMessageHandler", () => {
	it("ignores messages from unregistered sources", () => {
		const handler = createHostMessageHandler(buildHandlers())
		const source = fakeWindow()
		const event = fakeMessageEvent(
			{ type: "request", id: 1, method: pluginMethods.listFiles },
			source,
		)

		handler(event)

		expect(source.postMessage).not.toHaveBeenCalled()
	})

	it("ignores messages with unknown type", () => {
		const handler = createHostMessageHandler(buildHandlers())
		const source = fakeWindow()
		registerIframe(source, { pluginId: "p-1", resId: "r-1" })

		handler(
			new MessageEvent("message", {
				data: { type: "unknown", id: 1 },
				source,
				origin: "null",
			}),
		)

		expect(source.postMessage).not.toHaveBeenCalled()
	})

	describe("request routing", () => {
		it("routes readFile request", async () => {
			const handler = createHostMessageHandler(buildHandlers())
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })

			handler(
				fakeMessageEvent(
					{
						type: "request",
						id: 42,
						method: pluginMethods.readFile,
						params: { path: "page-01.png" },
					},
					source,
				),
			)

			await vi.waitFor(() => {
				expect(source.postMessage).toHaveBeenCalled()
			})

			expect(source.postMessage).toHaveBeenCalledWith(
				{
					type: "response",
					id: 42,
					ok: true,
					data: expect.any(ArrayBuffer),
				},
				"*",
			)
		})

		it("routes listFiles request", async () => {
			const handler = createHostMessageHandler(buildHandlers())
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })

			handler(
				fakeMessageEvent(
					{ type: "request", id: 1, method: pluginMethods.listFiles },
					source,
				),
			)

			await vi.waitFor(() => {
				expect(source.postMessage).toHaveBeenCalled()
			})
			expect(source.postMessage).toHaveBeenCalledWith(
				{
					type: "response",
					id: 1,
					ok: true,
					data: [{ filename: "a.png" }],
				},
				"*",
			)
		})

		it("routes listMessages request", async () => {
			const handler = createHostMessageHandler(buildHandlers())
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })

			handler(
				fakeMessageEvent(
					{
						type: "request",
						id: 2,
						method: pluginMethods.listMessages,
						params: { resId: "r-1" },
					},
					source,
				),
			)

			await vi.waitFor(() => {
				expect(source.postMessage).toHaveBeenCalled()
			})
		})

		it("routes createMessage request", async () => {
			const handler = createHostMessageHandler(buildHandlers())
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })

			handler(
				fakeMessageEvent(
					{
						type: "request",
						id: 3,
						method: pluginMethods.createMessage,
						params: { body: "hello" },
					},
					source,
				),
			)

			await vi.waitFor(() => {
				expect(source.postMessage).toHaveBeenCalled()
			})
		})

		it("routes prefSet request with pluginId", async () => {
			const handler = createHostMessageHandler(buildHandlers())
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })

			handler(
				fakeMessageEvent(
					{
						type: "request",
						id: 4,
						method: pluginMethods.setPref,
						params: { key: "theme", value: "dark" },
					},
					source,
				),
			)

			await vi.waitFor(() => {
				expect(source.postMessage).toHaveBeenCalled()
			})
		})
	})

	describe("request scope resolution", () => {
		async function readFileScopeByteLength(
			source: FakeWindow,
			request: PluginRequest,
		): Promise<number> {
			const handler = createHostMessageHandler(buildHandlers())
			handler(fakeMessageEvent(request, source))
			await vi.waitFor(() => {
				expect(source.postMessage).toHaveBeenCalled()
			})
			// The fake readFile handler encodes the scoped resId's length.
			const msg = vi.mocked(source.postMessage).mock
				.calls[0]?.[0] as unknown as { data: ArrayBuffer }
			return msg.data.byteLength
		}

		it("scopes unstamped requests to the current registration", async () => {
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })
			const size = await readFileScopeByteLength(source, {
				type: "request",
				id: 1,
				method: pluginMethods.readFile,
				params: { path: "a.png" },
			})
			expect(size).toBe(4 + "r-1".length)
		})

		it("adopts a stamp naming the current binding", async () => {
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })
			const size = await readFileScopeByteLength(source, {
				type: "request",
				id: 2,
				method: pluginMethods.readFile,
				params: { path: "a.png" },
				resId: "r-1",
			})
			expect(size).toBe(4 + "r-1".length)
		})

		it("drops a stale stamp after a rebind without invoking the handler", async () => {
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-old" })
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })
			const handler = createHostMessageHandler(buildHandlers())
			handler(
				fakeMessageEvent(
					{
						type: "request",
						id: 3,
						method: pluginMethods.readFile,
						params: { path: "a.png" },
						resId: "r-old",
					},
					source,
				),
			)
			await vi.waitFor(() => {
				expect(source.postMessage).toHaveBeenCalled()
			})
			// Acknowledged without data: the readFile handler never ran.
			expect(source.postMessage).toHaveBeenCalledWith(
				{ type: "response", id: 3, ok: true },
				"*",
			)
		})

		it("drops a stamp for a resource the iframe never held", async () => {
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })
			const handler = createHostMessageHandler(buildHandlers())
			handler(
				fakeMessageEvent(
					{
						type: "request",
						id: 4,
						method: pluginMethods.readFile,
						params: { path: "a.png" },
						resId: "r-foreign",
					},
					source,
				),
			)
			await vi.waitFor(() => {
				expect(source.postMessage).toHaveBeenCalled()
			})
			expect(source.postMessage).toHaveBeenCalledWith(
				{ type: "response", id: 4, ok: true },
				"*",
			)
		})
	})

	describe("error handling", () => {
		it("responds with ok:false when a handler throws", async () => {
			const handler = createHostMessageHandler([
				defineHandler("fail", async () => {
					throw new Error("boom")
				}),
			])
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })

			handler(
				fakeMessageEvent(
					{
						type: "request",
						id: 99,
						method: "fail",
						params: { relPath: "missing.png" },
					},
					source,
				),
			)

			await vi.waitFor(() => {
				expect(source.postMessage).toHaveBeenCalledWith(
					{
						type: "response",
						id: 99,
						ok: false,
						error: "boom",
					},
					"*",
				)
			})
		})

		it("responds with error message for unknown method", async () => {
			const handler = createHostMessageHandler(buildHandlers())
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })

			handler(
				fakeMessageEvent(
					{
						type: "request",
						id: 100,
						method: "unknownMethod",
					},
					source,
				),
			)

			await vi.waitFor(() => {
				expect(source.postMessage).toHaveBeenCalledWith(
					{
						type: "response",
						id: 100,
						ok: false,
						error: "Unknown method: unknownMethod",
					},
					"*",
				)
			})
		})
	})

	describe("subscribe messages", () => {
		it("records subscription via addSubscription", () => {
			const handler = createHostMessageHandler(buildHandlers())
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })

			handler(
				new MessageEvent("message", {
					data: { type: "subscribe", key: "theme:changed" },
					source,
					origin: "null",
				}),
			)

			// No response for subscribe — it's fire-and-forget
			expect(source.postMessage).not.toHaveBeenCalled()
		})
	})

	describe("cleanup", () => {
		it("does not respond after iframe is unregistered", async () => {
			const handler = createHostMessageHandler(buildHandlers())
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })
			unregisterIframe(source)

			handler(
				fakeMessageEvent(
					{ type: "request", id: 1, method: pluginMethods.listFiles },
					source,
				),
			)

			// Give async handlers time to fire
			await new Promise((r) => setTimeout(r, 10))
			expect(source.postMessage).not.toHaveBeenCalled()
		})
	})
})
