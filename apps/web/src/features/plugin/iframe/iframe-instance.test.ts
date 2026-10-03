import { hostPushKeys, type PluginIframeContext } from "@hoardodile/sdk-web"
import { waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createPluginIframe, setIframeContainer } from "./iframe-instance"
import { getIframeBySource } from "./iframe-registry"

// jsdom does not implement the iframe `sandbox` DOMTokenList; stub it so
// pool entry creation works under tests.
Object.defineProperty(HTMLIFrameElement.prototype, "sandbox", {
	configurable: true,
	value: { add: () => undefined },
})

describe("iframe-instance", () => {
	describe("claim", () => {
		function mountContainer(): HTMLElement {
			const el = document.createElement("div")
			document.body.appendChild(el)
			setIframeContainer(el)
			return el
		}

		afterEach(() => {
			setIframeContainer(undefined)
			document.body.innerHTML = ""
		})

		it("creates a fresh document after release even for the same plugin and assets", async () => {
			mountContainer()
			const first = createPluginIframe({
				pluginId: "p-reuse",
				assetVersion: "v1",
			})
			first.iframe.dispatchEvent(new Event("load"))
			first.release()
			await new Promise((resolve) => setTimeout(resolve, 110))

			const second = createPluginIframe({
				pluginId: "p-reuse",
				assetVersion: "v1",
			})

			expect(first.iframe.isConnected).toBe(false)
			expect(second.iframe).not.toBe(first.iframe)
			let called = false
			second.onLoaded(() => {
				called = true
			})
			expect(called).toBe(false)
		})

		it("creates the next document with the current asset fingerprint", () => {
			mountContainer()
			const first = createPluginIframe({
				pluginId: "p-reload",
				assetVersion: "v1",
			})
			first.iframe.dispatchEvent(new Event("load"))
			first.release()

			const second = createPluginIframe({
				pluginId: "p-reload",
				assetVersion: "v2",
			})

			expect(second.iframe).not.toBe(first.iframe)
			expect(second.iframe.src).toContain("v=v2")
			// The entry is loading again: no immediate load callback.
			let called = false
			second.onLoaded(() => {
				called = true
			})
			expect(called).toBe(false)
		})

		it("destroys the binding and cancels callbacks and pending loads on release", async () => {
			mountContainer()
			const slot = createPluginIframe({ pluginId: "p-cleanup", resId: "r-1" })
			const loaded = vi.fn()
			slot.onLoaded(loaded)
			const pending = slot.whenLoaded()
			slot.iframe.dispatchEvent(new Event("load"))
			await pending
			const source = slot.iframe.contentWindow
			if (source === null) throw new Error("no iframe window")
			expect(getIframeBySource(source)).toEqual({
				pluginId: "p-cleanup",
				resId: "r-1",
			})
			loaded.mockClear()
			slot.release()
			slot.release()
			slot.iframe.dispatchEvent(new Event("load"))
			expect(loaded).not.toHaveBeenCalled()
			expect(getIframeBySource(source)).toEqual({
				pluginId: "p-cleanup",
				resId: "r-1",
			})
			await waitFor(() => expect(getIframeBySource(source)).toBeUndefined())
			const cold = createPluginIframe({ pluginId: "p-cleanup", resId: "r-2" })
			const unfinished = cold.whenLoaded()
			cold.release()
			await expect(unfinished).resolves.toBeUndefined()
		})
	})

	describe("claim readiness (onReady)", () => {
		function mountContainer(): HTMLElement {
			const el = document.createElement("div")
			document.body.appendChild(el)
			setIframeContainer(el)
			return el
		}

		afterEach(() => {
			setIframeContainer(undefined)
			document.body.innerHTML = ""
		})

		// Acks only route to an entry once its window is registered, which
		// happens on iframe load â€” fire it before dispatching the ack.
		function loadIframe(iframe: HTMLIFrameElement): void {
			iframe.dispatchEvent(new Event("load"))
		}

		function dispatchPainted(
			source: MessageEventSource | null,
			resId: string,
			origin = "null",
		): void {
			window.dispatchEvent(
				new MessageEvent("message", {
					origin,
					source,
					data: { type: "contextPainted", resId },
				}),
			)
		}

		it("fires when the plugin acks the painted context", () => {
			mountContainer()
			const slot = createPluginIframe({ pluginId: "p-ack" })
			const cb = vi.fn()
			slot.onReady(cb)

			loadIframe(slot.iframe)
			dispatchPainted(slot.iframe.contentWindow, "r-1")

			expect(cb).toHaveBeenCalledOnce()
		})

		it("ignores a paint ack for a different resource", () => {
			mountContainer()
			const slot = createPluginIframe({
				pluginId: "p-bound",
				resId: "r-current",
			})
			const cb = vi.fn()
			slot.onReady(cb)
			loadIframe(slot.iframe)
			dispatchPainted(slot.iframe.contentWindow, "r-stale")
			expect(cb).not.toHaveBeenCalled()
			dispatchPainted(slot.iframe.contentWindow, "r-current")
			expect(cb).toHaveBeenCalledOnce()
		})

		it("fires at most once across repeated acks", () => {
			mountContainer()
			const slot = createPluginIframe({ pluginId: "p-ack-once" })
			const cb = vi.fn()
			slot.onReady(cb)

			loadIframe(slot.iframe)
			dispatchPainted(slot.iframe.contentWindow, "r-1")
			dispatchPainted(slot.iframe.contentWindow, "r-2")

			expect(cb).toHaveBeenCalledOnce()
		})

		it("invokes a late subscriber immediately once ready", () => {
			mountContainer()
			const slot = createPluginIframe({ pluginId: "p-ack-late" })
			loadIframe(slot.iframe)
			dispatchPainted(slot.iframe.contentWindow, "r-1")

			const cb = vi.fn()
			slot.onReady(cb)

			expect(cb).toHaveBeenCalledOnce()
		})

		it("ignores acks from a non-null origin", () => {
			mountContainer()
			const slot = createPluginIframe({ pluginId: "p-ack-origin" })
			const cb = vi.fn()
			slot.onReady(cb)

			loadIframe(slot.iframe)
			dispatchPainted(slot.iframe.contentWindow, "r-1", "https://evil.example")

			expect(cb).not.toHaveBeenCalled()
		})

		it("ignores acks from windows the pool does not own", () => {
			mountContainer()
			const slot = createPluginIframe({ pluginId: "p-ack-foreign" })
			const cb = vi.fn()
			slot.onReady(cb)

			dispatchPainted(null, "r-1")

			expect(cb).not.toHaveBeenCalled()
		})

		it("does not fire on acks arriving after release", () => {
			mountContainer()
			const slot = createPluginIframe({ pluginId: "p-ack-release" })
			const cb = vi.fn()
			slot.onReady(cb)
			loadIframe(slot.iframe)
			slot.release()

			dispatchPainted(slot.iframe.contentWindow, "r-1")

			expect(cb).not.toHaveBeenCalled()
		})

		it("stops firing after unsubscribe", () => {
			mountContainer()
			const slot = createPluginIframe({ pluginId: "p-ack-unsub" })
			const cb = vi.fn()
			const unsubscribe = slot.onReady(cb)
			loadIframe(slot.iframe)
			unsubscribe()

			dispatchPainted(slot.iframe.contentWindow, "r-1")

			expect(cb).not.toHaveBeenCalled()
		})

		it("fires via the fallback timer when no ack arrives (legacy SDK)", () => {
			vi.useFakeTimers()
			try {
				mountContainer()
				const slot = createPluginIframe({ pluginId: "p-ack-legacy" })
				const cb = vi.fn()
				slot.onReady(cb)

				vi.advanceTimersByTime(300)

				expect(cb).toHaveBeenCalledOnce()
			} finally {
				vi.useRealTimers()
			}
		})

		it("honors a custom ackTimeoutMs (prerender claims)", () => {
			vi.useFakeTimers()
			try {
				mountContainer()
				const slot = createPluginIframe({
					pluginId: "p-ack-custom",
					ackTimeoutMs: 5_000,
				})
				const cb = vi.fn()
				slot.onReady(cb)

				vi.advanceTimersByTime(300)
				expect(cb).not.toHaveBeenCalled()
				vi.advanceTimersByTime(4_700)
				expect(cb).toHaveBeenCalledOnce()
			} finally {
				vi.useRealTimers()
			}
		})

		it("release cancels the fallback timer", () => {
			vi.useFakeTimers()
			try {
				mountContainer()
				const slot = createPluginIframe({ pluginId: "p-ack-cancel" })
				const cb = vi.fn()
				slot.onReady(cb)
				slot.release()

				vi.advanceTimersByTime(300)

				expect(cb).not.toHaveBeenCalled()
			} finally {
				vi.useRealTimers()
			}
		})
	})

	describe("reloadAsset (live fingerprint change)", () => {
		// Scoped helpers for live asset changes.
		function mountContainer(): HTMLElement {
			const el = document.createElement("div")
			document.body.appendChild(el)
			setIframeContainer(el)
			return el
		}

		function loadIframe(iframe: HTMLIFrameElement): void {
			iframe.dispatchEvent(new Event("load"))
		}

		function dispatchPainted(
			source: MessageEventSource | null,
			resId: string,
			origin = "null",
		): void {
			window.dispatchEvent(
				new MessageEvent("message", {
					origin,
					source,
					data: { type: "contextPainted", resId },
				}),
			)
		}

		const context = {
			pluginId: "p-live",
			resId: "r-1",
			resName: "r-1",
			sourceMeta: undefined,
			searchMeta: undefined,
			fileStats: undefined,
			contentPluginId: "p-live",
			language: "en",
			resolvedTheme: "light",
			palette: "mono",
			iconStyle: "duotone",
			fonts: { family: "", cssPaths: [] },
			initialPrefs: {},
			initialCache: {},
			fileToken: "tok",
			assetToken: "",
		} satisfies PluginIframeContext

		afterEach(() => {
			setIframeContainer(undefined)
			document.body.innerHTML = ""
		})

		it("re-navigates a live instance to the new fingerprint", () => {
			mountContainer()
			const slot = createPluginIframe({
				pluginId: "p-live",
				assetVersion: "v1",
			})
			loadIframe(slot.iframe)
			slot.postContext({ ...context })
			// A previously painted document must load the replaced assets.
			dispatchPainted(slot.iframe.contentWindow, "r-1")

			const didReload = slot.reloadAsset("v2")

			expect(didReload).toBe(true)
			expect(slot.iframe.src).toContain("v=v2")
			// A second owner gets a separate document even at the same version.
			const re = createPluginIframe({
				pluginId: "p-live",
				resId: "r-1",
				assetVersion: "v2",
			})
			expect(re.iframe).not.toBe(slot.iframe)
			re.release()
		})

		it("is a no-op and returns false when the fingerprint is unchanged", () => {
			mountContainer()
			const slot = createPluginIframe({
				pluginId: "p-same",
				assetVersion: "v1",
			})
			loadIframe(slot.iframe)

			const didReload = slot.reloadAsset("v1")

			expect(didReload).toBe(false)
			expect(slot.iframe.src).toContain("v=v1")
		})

		it("rejects contexts belonging to another resource and ignores pushes after release", () => {
			mountContainer()
			const slot = createPluginIframe({ pluginId: "p-live", resId: "r-1" })
			loadIframe(slot.iframe)
			const source = slot.iframe.contentWindow
			if (source === null) throw new Error("no iframe window")
			const post = vi.spyOn(source, "postMessage")
			slot.postContext({ ...context, resId: "r-2" })
			expect(post).not.toHaveBeenCalled()
			slot.postContext(context)
			expect(
				post.mock.calls.filter(
					([message]) => message.key === hostPushKeys.context,
				),
			).toHaveLength(1)
			slot.release()
			post.mockClear()
			slot.postContext(context)
			slot.setVisibility(true)
			expect(post).not.toHaveBeenCalled()
		})

		it("records but does not reload when the entry had no fingerprint yet (cold-open baseline)", () => {
			mountContainer()
			// Cold open: the claim was built before the plugin list resolved.
			const slot = createPluginIframe({ pluginId: "p-cold" })
			loadIframe(slot.iframe)

			const didReload = slot.reloadAsset("v1")

			expect(didReload).toBe(false)
			// An unchanged fingerprint needs no second navigation.
			expect(slot.reloadAsset("v1")).toBe(false)
			expect(slot.iframe.src).not.toContain("v=")
		})
	})
})
