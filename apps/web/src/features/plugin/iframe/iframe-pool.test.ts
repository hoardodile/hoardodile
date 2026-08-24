import type { PluginIframeContext } from "@hoardodile/sdk-web"
import { afterEach, describe, expect, it, vi } from "vitest"
import { claim, setPoolContainer } from "./iframe-pool"

// jsdom does not implement the iframe `sandbox` DOMTokenList; stub it so
// pool entry creation works under tests.
Object.defineProperty(HTMLIFrameElement.prototype, "sandbox", {
	configurable: true,
	value: { add: () => undefined },
})

describe("iframe-pool", () => {
	describe("claim", () => {
		function mountContainer(): HTMLElement {
			const el = document.createElement("div")
			document.body.appendChild(el)
			setPoolContainer(el)
			return el
		}

		afterEach(() => {
			setPoolContainer(undefined)
			document.body.innerHTML = ""
		})

		it("reuses an idle entry without reloading when assetVersion matches", async () => {
			mountContainer()
			const first = claim({ pluginId: "p-reuse", assetVersion: "v1" })
			first.iframe.dispatchEvent(new Event("load"))
			first.release()

			const second = claim({ pluginId: "p-reuse", assetVersion: "v1" })

			expect(second.iframe).toBe(first.iframe)
			// The entry stayed loaded: no navigation happened, so load
			// callbacks fire immediately instead of after a fresh load.
			let called = false
			second.onLoaded(() => {
				called = true
			})
			expect(called).toBe(true)
			await expect(second.whenLoaded()).resolves.toBeUndefined()
		})

		it("reloads an idle entry when assetVersion changed", () => {
			mountContainer()
			const first = claim({ pluginId: "p-reload", assetVersion: "v1" })
			first.iframe.dispatchEvent(new Event("load"))
			first.release()

			const second = claim({ pluginId: "p-reload", assetVersion: "v2" })

			expect(second.iframe).toBe(first.iframe)
			expect(second.iframe.src).toContain("v=v2")
			// The entry is loading again: no immediate load callback.
			let called = false
			second.onLoaded(() => {
				called = true
			})
			expect(called).toBe(false)
		})
	})

	describe("claim readiness (onReady)", () => {
		function mountContainer(): HTMLElement {
			const el = document.createElement("div")
			document.body.appendChild(el)
			setPoolContainer(el)
			return el
		}

		afterEach(() => {
			setPoolContainer(undefined)
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
			const slot = claim({ pluginId: "p-ack" })
			const cb = vi.fn()
			slot.onReady(cb)

			loadIframe(slot.iframe)
			dispatchPainted(slot.iframe.contentWindow, "r-1")

			expect(cb).toHaveBeenCalledOnce()
		})

		it("fires at most once across repeated acks", () => {
			mountContainer()
			const slot = claim({ pluginId: "p-ack-once" })
			const cb = vi.fn()
			slot.onReady(cb)

			loadIframe(slot.iframe)
			dispatchPainted(slot.iframe.contentWindow, "r-1")
			dispatchPainted(slot.iframe.contentWindow, "r-2")

			expect(cb).toHaveBeenCalledOnce()
		})

		it("invokes a late subscriber immediately once ready", () => {
			mountContainer()
			const slot = claim({ pluginId: "p-ack-late" })
			loadIframe(slot.iframe)
			dispatchPainted(slot.iframe.contentWindow, "r-1")

			const cb = vi.fn()
			slot.onReady(cb)

			expect(cb).toHaveBeenCalledOnce()
		})

		it("ignores acks from a non-null origin", () => {
			mountContainer()
			const slot = claim({ pluginId: "p-ack-origin" })
			const cb = vi.fn()
			slot.onReady(cb)

			loadIframe(slot.iframe)
			dispatchPainted(slot.iframe.contentWindow, "r-1", "https://evil.example")

			expect(cb).not.toHaveBeenCalled()
		})

		it("ignores acks from windows the pool does not own", () => {
			mountContainer()
			const slot = claim({ pluginId: "p-ack-foreign" })
			const cb = vi.fn()
			slot.onReady(cb)

			dispatchPainted(null, "r-1")

			expect(cb).not.toHaveBeenCalled()
		})

		it("does not fire on acks arriving after release", () => {
			mountContainer()
			const slot = claim({ pluginId: "p-ack-release" })
			const cb = vi.fn()
			slot.onReady(cb)
			loadIframe(slot.iframe)
			slot.release()

			dispatchPainted(slot.iframe.contentWindow, "r-1")

			expect(cb).not.toHaveBeenCalled()
		})

		it("stops firing after unsubscribe", () => {
			mountContainer()
			const slot = claim({ pluginId: "p-ack-unsub" })
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
				const slot = claim({ pluginId: "p-ack-legacy" })
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
				const slot = claim({
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
				const slot = claim({ pluginId: "p-ack-cancel" })
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

	describe("primed claims (lastAckedResId)", () => {
		function mountContainer(): HTMLElement {
			const el = document.createElement("div")
			document.body.appendChild(el)
			setPoolContainer(el)
			return el
		}

		afterEach(() => {
			setPoolContainer(undefined)
			document.body.innerHTML = ""
		})

		function loadIframe(iframe: HTMLIFrameElement): void {
			iframe.dispatchEvent(new Event("load"))
		}

		function dispatchPainted(
			source: MessageEventSource | null,
			resId: string,
		): void {
			window.dispatchEvent(
				new MessageEvent("message", {
					origin: "null",
					source,
					data: { type: "contextPainted", resId },
				}),
			)
		}

		// Runs the prerender pipeline by hand: claim, paint, ack, release â€”
		// the entry goes back into the pool with lastAckedResId set.
		function primeEntry(pluginId: string, resId: string): HTMLIFrameElement {
			const slot = claim({ pluginId, resId })
			loadIframe(slot.iframe)
			dispatchPainted(slot.iframe.contentWindow, resId)
			slot.release()
			return slot.iframe
		}

		it("fires readiness immediately for a claim matching the acked resId", () => {
			mountContainer()
			const iframe = primeEntry("p-primed", "r-x")

			const slot = claim({ pluginId: "p-primed", resId: "r-x" })

			expect(slot.iframe).toBe(iframe)
			expect(slot.primedResId).toBe("r-x")
			// Synchronous: ready upfront, no ack or timer involved.
			const cb = vi.fn()
			slot.onReady(cb)
			expect(cb).toHaveBeenCalledOnce()
			slot.release()
		})

		it("does not arm the fallback timer for a primed claim", () => {
			vi.useFakeTimers()
			try {
				mountContainer()
				primeEntry("p-primed-timer", "r-x")

				const slot = claim({ pluginId: "p-primed-timer", resId: "r-x" })
				expect(slot.primedResId).toBe("r-x")
				const cb = vi.fn()
				slot.onReady(cb)
				expect(cb).toHaveBeenCalledOnce()

				// No fallback timer and no painted listener: nothing more fires.
				vi.advanceTimersByTime(600)
				expect(cb).toHaveBeenCalledOnce()
				slot.release()
			} finally {
				vi.useRealTimers()
			}
		})

		it("is not primed for a different resId", () => {
			vi.useFakeTimers()
			try {
				mountContainer()
				primeEntry("p-primed-other", "r-x")

				const slot = claim({ pluginId: "p-primed-other", resId: "r-y" })
				expect(slot.primedResId).toBeUndefined()
				const cb = vi.fn()
				slot.onReady(cb)
				expect(cb).not.toHaveBeenCalled()

				// Normal readiness path: the legacy fallback still applies.
				vi.advanceTimersByTime(300)
				expect(cb).toHaveBeenCalledOnce()
				slot.release()
			} finally {
				vi.useRealTimers()
			}
		})

		it("is never primed without a resId", () => {
			mountContainer()
			primeEntry("p-primed-nores", "r-x")

			const slot = claim({ pluginId: "p-primed-nores" })
			expect(slot.primedResId).toBeUndefined()
			slot.release()
		})

		it("postContext clears the primed state until a new ack arrives", () => {
			mountContainer()
			const iframe = primeEntry("p-primed-post", "r-x")

			const first = claim({ pluginId: "p-primed-post", resId: "r-x" })
			expect(first.primedResId).toBe("r-x")
			const ctx: PluginIframeContext = {
				pluginId: "p-primed-post",
				resId: "r-z",
				resName: "z",
				sourceMeta: undefined,
				searchMeta: undefined,
				fileStats: undefined,
				contentPluginId: "p-primed-post",
				language: "en",
				resolvedTheme: "light",
				palette: "mono",
				iconStyle: "duotone",
				fonts: { family: "", cssPaths: [] },
				initialPrefs: {},
				initialCache: {},
				fileToken: "",
				assetToken: "",
			}
			first.postContext(ctx)
			first.release()

			const second = claim({ pluginId: "p-primed-post", resId: "r-x" })
			expect(second.iframe).toBe(iframe)
			expect(second.primedResId).toBeUndefined()
			second.release()
		})

		it("assetVersion reload clears the primed state", () => {
			mountContainer()
			const first = claim({ pluginId: "p-primed-reload", assetVersion: "v1" })
			loadIframe(first.iframe)
			dispatchPainted(first.iframe.contentWindow, "r-x")
			first.release()

			const second = claim({
				pluginId: "p-primed-reload",
				assetVersion: "v2",
				resId: "r-x",
			})
			expect(second.iframe.src).toContain("v=v2")
			expect(second.primedResId).toBeUndefined()
			second.release()
		})

		it("a document reload (re-parent) clears the primed state", () => {
			mountContainer()
			const iframe = primeEntry("p-primed-reparent", "r-x")

			// Re-parenting an iframe reloads its document in real browsers;
			// the second load event is the pool's only signal. The fresh
			// document has painted nothing, so the ack memory must go â€”
			// otherwise a later claim would be primed onto a blank page.
			loadIframe(iframe)

			const slot = claim({ pluginId: "p-primed-reparent", resId: "r-x" })
			expect(slot.iframe).toBe(iframe)
			expect(slot.primedResId).toBeUndefined()
			slot.release()
		})
	})

	describe("eviction (TTL + disconnected entries)", () => {
		function mountContainer(): HTMLElement {
			const el = document.createElement("div")
			document.body.appendChild(el)
			setPoolContainer(el)
			return el
		}

		afterEach(() => {
			setPoolContainer(undefined)
			document.body.innerHTML = ""
		})

		// The pool timestamps releases with performance.now, so the fake
		// clock must cover it (vitest's default toFake list does not).
		function fakeClock(): void {
			vi.useFakeTimers({
				toFake: [
					"setTimeout",
					"clearTimeout",
					"setInterval",
					"clearInterval",
					"Date",
					"performance",
				],
			})
		}

		it("destroys idle entries past the TTL, primary included", () => {
			fakeClock()
			try {
				const el = mountContainer()
				const slot = claim({ pluginId: "p-ttl-idle" })
				slot.release()
				expect(el.querySelectorAll("iframe")).toHaveLength(1)

				// Past the 60s TTL at the next 5s eviction tick.
				vi.advanceTimersByTime(65_000)

				expect(el.querySelectorAll("iframe")).toHaveLength(0)
			} finally {
				vi.useRealTimers()
			}
		})

		it("keeps claimed entries past the TTL, destroys them once released and aged", () => {
			fakeClock()
			try {
				const el = mountContainer()
				const slot = claim({ pluginId: "p-ttl-claimed" })

				vi.advanceTimersByTime(120_000)
				expect(el.querySelectorAll("iframe")).toHaveLength(1)

				slot.release()
				vi.advanceTimersByTime(65_000)
				expect(el.querySelectorAll("iframe")).toHaveLength(0)
			} finally {
				vi.useRealTimers()
			}
		})

		it("destroys a disconnected entry instead of handing it out again", () => {
			const el = mountContainer()
			const first = claim({ pluginId: "p-zombie" })
			first.release()
			// The inline preview detaches its iframe on cleanup rather
			// than re-parenting it back into the pool container.
			first.iframe.remove()

			const second = claim({ pluginId: "p-zombie" })

			expect(second.iframe).not.toBe(first.iframe)
			expect(el.querySelectorAll("iframe")).toHaveLength(1)
			second.release()
		})
	})
})
