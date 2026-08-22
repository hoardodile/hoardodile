import { describe, expect, it, vi } from "vitest"
import {
	addSubscription,
	broadcastToAll,
	broadcastToResource,
	broadcastToSubscribers,
	getIframeBySource,
	registerIframe,
	resolvePluginMessageSource,
	unregisterIframe,
} from "./iframe-registry"

function fakeWindow(): Window {
	return { postMessage: vi.fn() } as unknown as Window
}

describe("iframe-registry", () => {
	describe("registerIframe / getIframeBySource / unregisterIframe", () => {
		it("registers and retrieves an iframe by source", () => {
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })
			expect(getIframeBySource(source)).toEqual({
				pluginId: "p-1",
				resId: "r-1",
			})
		})

		it("returns undefined for unregistered source", () => {
			const source = fakeWindow()
			expect(getIframeBySource(source)).toBeUndefined()
		})

		it("unregisters and returns undefined after unregisterIframe", () => {
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })
			unregisterIframe(source)
			expect(getIframeBySource(source)).toBeUndefined()
		})

		it("supports multiple iframes for the same resource", () => {
			const a = fakeWindow()
			const b = fakeWindow()
			registerIframe(a, { pluginId: "p-1", resId: "r-shared" })
			registerIframe(b, { pluginId: "p-1", resId: "r-shared" })
			expect(getIframeBySource(a)).toBeDefined()
			expect(getIframeBySource(b)).toBeDefined()
		})

		it("unregistering one iframe does not affect the other", () => {
			const a = fakeWindow()
			const b = fakeWindow()
			registerIframe(a, { pluginId: "p-1", resId: "r-shared" })
			registerIframe(b, { pluginId: "p-1", resId: "r-shared" })
			unregisterIframe(a)
			expect(getIframeBySource(a)).toBeUndefined()
			expect(getIframeBySource(b)).toBeDefined()
		})

		it("rebinds on re-register", () => {
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })
			registerIframe(source, { pluginId: "p-1", resId: "r-2" })
			expect(getIframeBySource(source)).toEqual({
				pluginId: "p-1",
				resId: "r-2",
			})
		})
	})

	describe("broadcastToResource", () => {
		it("sends postMessage to every iframe for the resource", () => {
			const a = fakeWindow()
			const b = fakeWindow()
			const c = fakeWindow()
			registerIframe(a, { pluginId: "p-1", resId: "r-1" })
			registerIframe(b, { pluginId: "p-1", resId: "r-1" })
			registerIframe(c, { pluginId: "p-1", resId: "r-2" })

			broadcastToResource("r-1", {
				type: "push",
				key: "test",
				data: "hello",
			})

			expect(a.postMessage).toHaveBeenCalledWith(
				{ type: "push", key: "test", data: "hello" },
				"*",
			)
			expect(b.postMessage).toHaveBeenCalledWith(
				{ type: "push", key: "test", data: "hello" },
				"*",
			)
			expect(c.postMessage).not.toHaveBeenCalled()
		})

		it("is a no-op when no iframes are registered for the resource", () => {
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-2" })
			broadcastToResource("r-nonexistent", {
				type: "push",
				key: "test",
			})
			expect(source.postMessage).not.toHaveBeenCalled()
		})
	})

	describe("broadcastToAll", () => {
		it("sends postMessage to every registered iframe", () => {
			const a = fakeWindow()
			const b = fakeWindow()
			registerIframe(a, { pluginId: "p-1", resId: "r-1" })
			registerIframe(b, { pluginId: "p-2", resId: "r-2" })

			broadcastToAll({ type: "push", key: "theme:changed" })

			expect(a.postMessage).toHaveBeenCalledWith(
				{ type: "push", key: "theme:changed" },
				"*",
			)
			expect(b.postMessage).toHaveBeenCalledWith(
				{ type: "push", key: "theme:changed" },
				"*",
			)
		})

		it("is a no-op when no iframes are registered", () => {
			expect(() => broadcastToAll({ type: "push", key: "test" })).not.toThrow()
		})

		it("skips iframes the filter excludes", () => {
			const a = fakeWindow()
			const b = fakeWindow()
			registerIframe(a, { pluginId: "p-1", resId: "r-f1" })
			registerIframe(b, { pluginId: "p-2", resId: "r-f2" })

			broadcastToAll(
				{ type: "push", key: "fontsChanged" },
				(record) => record.pluginId !== "p-2",
			)

			expect(a.postMessage).toHaveBeenCalledWith(
				{ type: "push", key: "fontsChanged" },
				"*",
			)
			expect(b.postMessage).not.toHaveBeenCalled()
		})
	})

	describe("subscriptions", () => {
		it("broadcasts to subscribers only for the matching key", () => {
			const a = fakeWindow()
			const b = fakeWindow()
			registerIframe(a, { pluginId: "p-1", resId: "r-1" })
			registerIframe(b, { pluginId: "p-1", resId: "r-1" })
			addSubscription(a, "theme:changed")
			// b is NOT subscribed to any key

			broadcastToSubscribers("theme:changed", { dark: true })

			expect(a.postMessage).toHaveBeenCalledWith(
				{ type: "push", key: "theme:changed", data: { dark: true } },
				"*",
			)
			expect(b.postMessage).not.toHaveBeenCalled()
		})

		it("clears subscriptions when iframe is unregistered", () => {
			const source = fakeWindow()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })
			addSubscription(source, "theme:changed")
			unregisterIframe(source)

			broadcastToSubscribers("theme:changed")
			expect(source.postMessage).not.toHaveBeenCalled()
		})
	})

	describe("resolvePluginMessageSource", () => {
		// jsdom accepts an EventTarget as a MessageEvent source; a plain
		// object would not survive the WebIDL conversion.
		function fakeMessageSource(): Window {
			const w = new EventTarget() as unknown as Window
			w.postMessage = vi.fn()
			return w
		}

		function messageEvent(
			source: MessageEventSource | null,
			origin = "null",
		): MessageEvent {
			return new MessageEvent("message", { data: {}, source, origin })
		}

		it("returns undefined when the origin is not the sandbox opaque origin", () => {
			const source = fakeMessageSource()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })

			expect(
				resolvePluginMessageSource(
					messageEvent(source, "https://evil.example"),
				),
			).toBeUndefined()
		})

		it("returns undefined when the event has no source window", () => {
			expect(resolvePluginMessageSource(messageEvent(null))).toBeUndefined()
		})

		it("returns undefined for a source that is not a registered iframe", () => {
			expect(
				resolvePluginMessageSource(messageEvent(fakeMessageSource())),
			).toBeUndefined()
		})

		it("returns the source and its record for a registered iframe", () => {
			const source = fakeMessageSource()
			registerIframe(source, { pluginId: "p-1", resId: "r-1" })

			expect(resolvePluginMessageSource(messageEvent(source))).toEqual({
				source,
				record: { pluginId: "p-1", resId: "r-1" },
			})
		})

		it("never probes the source with `in` — cross-origin windows throw", () => {
			// A sandboxed plugin iframe is a cross-origin Window proxy:
			// any `in`/property probe on it raises SecurityError. Simulate
			// that so the narrowing guard can never regress to duck-typing.
			const crossOriginWindow = new Proxy(
				{},
				{
					has() {
						throw new DOMException(
							"Blocked a frame from accessing a cross-origin frame.",
							"SecurityError",
						)
					},
				},
			)
			const event = {
				origin: "null",
				source: crossOriginWindow,
			} as unknown as MessageEvent

			expect(() => resolvePluginMessageSource(event)).not.toThrow()
			expect(resolvePluginMessageSource(event)).toBeUndefined()
		})
	})
})
