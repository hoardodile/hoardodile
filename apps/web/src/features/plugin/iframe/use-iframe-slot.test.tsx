import { hostPushKeys } from "@hoardodile/sdk-web"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { prefKeys } from "@/lib/keys"
import type { PoolClaimedEntry } from "./iframe-pool"
import { claim, setPoolContainer } from "./iframe-pool"
import type { PreviewWindowSnapshot } from "./preview-window"
import {
	buildPluginIframeContext,
	useIframeLifecycle,
	usePluginIframeSlot,
	useWindowGeometrySync,
} from "./use-iframe-slot"

// Detail-card payloads the trpcQuery mock hands back, keyed by resId.
// Set per test before rendering.
let cardPlugins: Record<string, string> = {}

const trpcQuery = vi.fn((...args: unknown[]) => {
	const [namespace, procedure, input] = args
	if (namespace === "resource" && procedure === "detailCard") {
		if (typeof input !== "object" || input === null || !("id" in input)) {
			return Promise.reject(new Error("bad detailCard input"))
		}
		const id = String(input.id)
		return Promise.resolve({
			id,
			name: `name-${id}`,
			contentPluginId: cardPlugins[id] ?? null,
			sourceMeta: undefined,
			searchMeta: undefined,
			fileStats: undefined,
		})
	}
	// plugin.previewInitContext
	return Promise.resolve<unknown>(null)
})

vi.mock("@/trpc/factory", () => ({
	trpcQuery: (...args: unknown[]) => trpcQuery(...args),
}))

vi.mock("../pluginApi", () => ({
	pluginListAllQueryOptions: () => ({ queryKey: ["plugin", "listAll"] }),
	previewInitContextQueryOptions: (opts: unknown) => ({
		queryKey: ["plugin", "previewInitContext", opts],
		queryFn: () => trpcQuery("plugin", "previewInitContext", opts),
		staleTime: 30_000,
	}),
}))

vi.mock("@/features/res/api", () => ({
	resDetailCardQueryOptions: (id: string) => ({
		queryKey: ["resource", "detailCard", id],
		queryFn: () => trpcQuery("resource", "detailCard", { id }),
		staleTime: 2_000,
	}),
}))

type Rect = {
	readonly top: number
	readonly left: number
	readonly width: number
	readonly height: number
}

function makeDomRect(rect: Rect): DOMRect {
	return {
		...rect,
		right: rect.left + rect.width,
		bottom: rect.top + rect.height,
		x: rect.left,
		y: rect.top,
		toJSON: () => ({}),
	} as DOMRect
}

// A fake iframe whose style is a plain proxied object, so tests can both
// read the final values and count every individual write.
function makeSlot() {
	const writes = new Map<string, string[]>()
	const style = new Proxy({} as Record<string, string>, {
		set(target, prop, value: string) {
			const key = String(prop)
			writes.set(key, [...(writes.get(key) ?? []), value])
			target[key] = value
			return true
		},
	})
	const slot = { iframe: { style } } as unknown as PoolClaimedEntry
	function writeCount(prop: string): number {
		return writes.get(prop)?.length ?? 0
	}
	return { slot, style, writeCount }
}

// A minimal fake preview window serving a fixed slot list, for driving
// the geometry sync without the real pool.
function fakeWindow(slots: PoolClaimedEntry[]) {
	const listeners = new Set<() => void>()
	return {
		previewWindow: {
			getSnapshot: (): PreviewWindowSnapshot => ({
				focusedResId: "",
				presentedResId: null,
				focusedReady: false,
				slots: slots.map((slotClaim, i) => ({
					resId: `r-${i}`,
					pluginId: "p",
					iframe: slotClaim.iframe,
					claim: slotClaim,
					ready: false,
					presented: false,
				})),
			}),
			subscribe: (cb: () => void) => {
				listeners.add(cb)
				return () => {
					listeners.delete(cb)
				}
			},
		},
		notify: () => {
			for (const cb of listeners) {
				cb()
			}
		},
	}
}

function makePlaceholder(rect: Rect): HTMLElement {
	const el = document.createElement("div")
	document.body.appendChild(el)
	vi.spyOn(el, "getBoundingClientRect").mockReturnValue(makeDomRect(rect))
	return el
}

afterEach(() => {
	vi.restoreAllMocks()
	cardPlugins = {}
	document.body.innerHTML = ""
})

describe("useWindowGeometrySync", () => {
	it("writes rounded geometry on mount", () => {
		const placeholder = makePlaceholder({
			top: 10.4,
			left: 20.6,
			width: 100.5,
			height: 200.4,
		})
		const { slot, style } = makeSlot()
		const { previewWindow } = fakeWindow([slot])

		renderHook(() =>
			useWindowGeometrySync({ placeholder, window: previewWindow }),
		)

		expect(style.display).toBe("block")
		expect(style.top).toBe("10px")
		expect(style.left).toBe("21px")
		expect(style.width).toBe("101px")
		expect(style.height).toBe("200px")
	})

	it("never touches presentation properties (the window owns those)", () => {
		const placeholder = makePlaceholder({
			top: 10,
			left: 20,
			width: 100,
			height: 200,
		})
		const { slot, writeCount } = makeSlot()
		const { previewWindow } = fakeWindow([slot])

		renderHook(() =>
			useWindowGeometrySync({ placeholder, window: previewWindow }),
		)
		window.dispatchEvent(new Event("resize"))

		for (const prop of ["opacity", "pointerEvents", "zIndex"]) {
			expect(writeCount(prop)).toBe(0)
		}
	})

	it("does not rewrite unchanged values on window resize", async () => {
		const placeholder = makePlaceholder({
			top: 10,
			left: 20,
			width: 100,
			height: 200,
		})
		const { slot, writeCount } = makeSlot()
		const { previewWindow } = fakeWindow([slot])

		renderHook(() =>
			useWindowGeometrySync({ placeholder, window: previewWindow }),
		)
		// Flush the setup-stub ResizeObserver's initial microtask callback.
		await Promise.resolve()

		for (const prop of ["top", "left", "width", "height"]) {
			expect(writeCount(prop)).toBe(1)
		}

		// A resize with an unchanged rect must not produce further writes.
		window.dispatchEvent(new Event("resize"))
		for (const prop of ["top", "left", "width", "height"]) {
			expect(writeCount(prop)).toBe(1)
		}
	})

	it("rewrites only the values that changed", () => {
		const rect = { top: 10, left: 20, width: 100, height: 200 }
		const placeholder = makePlaceholder(rect)
		const { slot, style, writeCount } = makeSlot()
		const { previewWindow } = fakeWindow([slot])

		renderHook(() =>
			useWindowGeometrySync({ placeholder, window: previewWindow }),
		)

		vi.mocked(placeholder.getBoundingClientRect).mockReturnValue(
			makeDomRect({ ...rect, top: 30.6 }),
		)
		window.dispatchEvent(new Event("resize"))

		expect(style.top).toBe("31px")
		expect(writeCount("top")).toBe(2)
		expect(writeCount("left")).toBe(1)
		expect(writeCount("width")).toBe(1)
		expect(writeCount("height")).toBe(1)
	})

	it("hides the iframe when the placeholder has no size", () => {
		const placeholder = makePlaceholder({
			top: 0,
			left: 0,
			width: 0,
			height: 0,
		})
		const { slot, style } = makeSlot()
		const { previewWindow } = fakeWindow([slot])

		renderHook(() =>
			useWindowGeometrySync({ placeholder, window: previewWindow }),
		)

		expect(style.display).toBe("none")
		expect(style.width).toBeUndefined()
	})

	it("stacks slots added after mount when the window notifies", () => {
		const placeholder = makePlaceholder({
			top: 10,
			left: 20,
			width: 100,
			height: 200,
		})
		const first = makeSlot()
		const slots = [first.slot]
		const { previewWindow, notify } = fakeWindow(slots)

		renderHook(() =>
			useWindowGeometrySync({ placeholder, window: previewWindow }),
		)
		expect(first.style.display).toBe("block")

		// A newly claimed window slot gets stacked over the placeholder on
		// the window's notification, not on the next RO tick.
		const second = makeSlot()
		slots.push(second.slot)
		notify()

		expect(second.style.display).toBe("block")
		expect(second.style.top).toBe("10px")
		expect(second.style.width).toBe("100px")
	})

	it("stops syncing after unmount", () => {
		const rect = { top: 10, left: 20, width: 100, height: 200 }
		const placeholder = makePlaceholder(rect)
		const { slot, style } = makeSlot()
		const { previewWindow } = fakeWindow([slot])

		const { unmount } = renderHook(() =>
			useWindowGeometrySync({ placeholder, window: previewWindow }),
		)
		unmount()

		vi.mocked(placeholder.getBoundingClientRect).mockReturnValue(
			makeDomRect({ ...rect, top: 99 }),
		)
		window.dispatchEvent(new Event("resize"))

		expect(style.top).toBe("10px")
	})
})

describe("useIframeLifecycle", () => {
	function makeLifecycleSlot() {
		const setVisibility = vi.fn()
		const slot: PoolClaimedEntry = {
			iframe: document.createElement("iframe"),
			primedResId: undefined,
			release: () => {},
			postContext: () => {},
			setVisibility,
			// Never fires: keeps the slot in the loading state so the
			// visibility gate is the only thing under test.
			onLoaded: () => () => {},
			whenLoaded: () => new Promise<void>(() => {}),
			onReady: () => () => {},
		}
		return { slot, setVisibility }
	}

	it("gates visibility pushes on the slot being ready", () => {
		const placeholder = makePlaceholder({
			top: 0,
			left: 0,
			width: 100,
			height: 100,
		})
		const { slot, setVisibility } = makeLifecycleSlot()

		const { rerender } = renderHook(
			({ slotReady }) =>
				useIframeLifecycle({
					slot,
					placeholder,
					pluginId: "p-1",
					resId: "r-1",
					slotReady,
				}),
			{ initialProps: { slotReady: false } },
		)
		expect(setVisibility).not.toHaveBeenCalled()

		rerender({ slotReady: true })
		expect(setVisibility).toHaveBeenCalledWith(true)
	})
})

describe("buildPluginIframeContext", () => {
	const base = {
		pluginId: "p-1",
		resId: "r-1",
		resName: "name",
		sourceMeta: undefined,
		contentPluginId: "p-1",
	}

	afterEach(() => {
		const root = document.documentElement
		root.classList.remove("dark")
		for (const cls of [...root.classList]) {
			if (cls.startsWith("theme-")) root.classList.remove(cls)
		}
		localStorage.removeItem(prefKeys.appFont)
	})

	it("uses forceTheme over the document class", () => {
		document.documentElement.classList.add("dark")
		const ctx = buildPluginIframeContext({ ...base, forceTheme: "light" })
		expect(ctx.resolvedTheme).toBe("light")
	})

	it("reads the dark class when forceTheme is absent", () => {
		document.documentElement.classList.add("dark")
		expect(buildPluginIframeContext(base).resolvedTheme).toBe("dark")
		document.documentElement.classList.remove("dark")
		expect(buildPluginIframeContext(base).resolvedTheme).toBe("light")
	})

	it("reads a known palette from the class list and falls back to default", () => {
		document.documentElement.classList.add("theme-parchment")
		expect(buildPluginIframeContext(base).palette).toBe("parchment")
		document.documentElement.classList.remove("theme-parchment")
		expect(buildPluginIframeContext(base).palette).toBe("mono")
	})

	it("reads the mono and azure palettes from the class list", () => {
		document.documentElement.classList.add("theme-mono")
		expect(buildPluginIframeContext(base).palette).toBe("mono")
		document.documentElement.classList.remove("theme-mono")
		document.documentElement.classList.add("theme-azure")
		expect(buildPluginIframeContext(base).palette).toBe("azure")
	})

	it("assembles the font context from the app font pref", () => {
		localStorage.setItem(prefKeys.appFont, JSON.stringify(["Georgia", "serif"]))
		const ctx = buildPluginIframeContext(base)
		expect(ctx.fonts.family).toBe("Georgia, serif")
		expect(ctx.fonts.cssPaths).toEqual([])
	})

	it("falls back to empty fonts when no app font pref is stored", () => {
		expect(buildPluginIframeContext(base).fonts).toEqual({
			family: "",
			cssPaths: [],
		})
	})

	it("sends empty fonts when the plugin opts out of font inheritance", () => {
		localStorage.setItem(prefKeys.appFont, JSON.stringify(["inter"]))
		const ctx = buildPluginIframeContext({ ...base, inheritFont: false })
		expect(ctx.fonts).toEqual({ family: "", cssPaths: [] })
	})

	it("merges the init payload and falls back to empty values", () => {
		const withInit = buildPluginIframeContext({
			...base,
			init: { prefs: { a: "1" }, cache: { b: "2" }, fileToken: "tok" },
		})
		expect(withInit.initialPrefs).toEqual({ a: "1" })
		expect(withInit.initialCache).toEqual({ b: "2" })
		expect(withInit.fileToken).toBe("tok")

		const withoutInit = buildPluginIframeContext(base)
		expect(withoutInit.initialPrefs).toEqual({})
		expect(withoutInit.initialCache).toEqual({})
		expect(withoutInit.fileToken).toBe("")
	})
})

describe("usePluginIframeSlot", () => {
	// jsdom does not implement the iframe `sandbox` DOMTokenList; stub it so
	// pool entry creation works under tests.
	Object.defineProperty(HTMLIFrameElement.prototype, "sandbox", {
		configurable: true,
		value: { add: () => undefined },
	})

	function setup() {
		const container = document.createElement("div")
		document.body.appendChild(container)
		setPoolContainer(container)
		const queryClient = new QueryClient()
		function wrapper({ children }: { children: ReactNode }) {
			return (
				<QueryClientProvider client={queryClient}>
					{children}
				</QueryClientProvider>
			)
		}
		return { container, wrapper }
	}

	afterEach(() => {
		setPoolContainer(undefined)
	})

	function slotOptions(pluginId: string, resId: string) {
		return {
			pluginId,
			resId,
			resName: "name",
			sourceMeta: undefined,
			contentPluginId: pluginId,
		}
	}

	function getIframe(container: HTMLElement, index = 0): HTMLIFrameElement {
		const iframe = container.querySelectorAll("iframe")[index]
		if (iframe === undefined) throw new Error("no iframe in pool container")
		return iframe
	}

	function dispatchContextPainted(
		iframe: HTMLIFrameElement,
		resId: string,
	): void {
		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "null",
				source: iframe.contentWindow,
				data: { type: "contextPainted", resId },
			}),
		)
	}

	function isContextPush(msg: unknown): boolean {
		if (typeof msg !== "object" || msg === null) return false
		if (!("key" in msg)) return false
		return msg.key === hostPushKeys.context
	}

	function attachPlaceholder(result: {
		current: { ref: (el: HTMLElement | null) => void }
	}): HTMLElement {
		const placeholder = makePlaceholder({
			top: 0,
			left: 0,
			width: 100,
			height: 100,
		})
		act(() => {
			result.current.ref(placeholder)
		})
		return placeholder
	}

	async function flushMicrotasks(): Promise<void> {
		await act(async () => {
			await Promise.resolve()
		})
	}

	// The window's context push chains fetchQuery → whenLoaded, so one
	// microtask round is not enough.
	async function flushAll(): Promise<void> {
		for (let i = 0; i < 5; i++) {
			await flushMicrotasks()
		}
	}

	it("keeps the iframe hidden until the plugin acks the context", async () => {
		const { container, wrapper } = setup()
		const { result } = renderHook(
			() => usePluginIframeSlot(slotOptions("p-ack", "r-1")),
			{ wrapper },
		)
		attachPlaceholder(result)
		const iframe = getIframe(container)

		// Cold open: nothing presented yet.
		expect(result.current.presented).toBe(false)

		// Let the iframe "load" and the context push resolve; without an
		// ack the stale-tree guard keeps the iframe transparent.
		act(() => {
			iframe.dispatchEvent(new Event("load"))
		})
		await flushAll()
		expect(iframe.style.opacity).toBe("0")

		act(() => {
			dispatchContextPainted(iframe, "r-1")
		})
		expect(iframe.style.opacity).toBe("1")
		expect(result.current.presented).toBe(true)
	})

	it("holds the previous iframe on screen across a resId switch until the new one acks", async () => {
		const { container, wrapper } = setup()
		const { result, rerender } = renderHook(
			({ resId }) => usePluginIframeSlot(slotOptions("p-switch", resId)),
			{ wrapper, initialProps: { resId: "r-1" } },
		)
		attachPlaceholder(result)
		const iframeA = getIframe(container, 0)
		act(() => {
			iframeA.dispatchEvent(new Event("load"))
		})
		await flushAll()
		act(() => {
			dispatchContextPainted(iframeA, "r-1")
		})
		expect(iframeA.style.opacity).toBe("1")

		// Same plugin, new resId: in the window model the new resource gets
		// its own iframe. The old one is held — still claimed, still opaque
		// — while the new one is painted-but-transparent so its plugin
		// keeps producing frames and the contextPainted ack can fire.
		rerender({ resId: "r-2" })
		await flushAll()
		const iframeB = getIframe(container, 1)
		expect(result.current.presented).toBe(true)
		expect(iframeA.style.opacity).toBe("1")
		expect(iframeB.style.display).toBe("block")
		expect(iframeB.style.opacity).toBe("0")

		// Loaded but not yet acked: the held slot stays on screen.
		act(() => {
			iframeB.dispatchEvent(new Event("load"))
		})
		await flushAll()
		expect(iframeA.style.opacity).toBe("1")
		expect(iframeB.style.opacity).toBe("0")

		// The ack flips presentation and releases the held slot: B is
		// shown, A goes back to the pool (display:none by release).
		act(() => {
			dispatchContextPainted(iframeB, "r-2")
		})
		expect(iframeB.style.opacity).toBe("1")
		expect(iframeA.style.display).toBe("none")
		expect(result.current.presented).toBe(true)
	})

	it("keeps the outgoing iframe on screen until the incoming one acks (cross-plugin switch)", async () => {
		const { container, wrapper } = setup()
		const { result, rerender } = renderHook(
			({ pluginId, resId }) =>
				usePluginIframeSlot(slotOptions(pluginId, resId)),
			{
				wrapper,
				initialProps: { pluginId: "p-claim-a", resId: "r-1" },
			},
		)
		attachPlaceholder(result)
		const iframeA = getIframe(container, 0)
		act(() => {
			iframeA.dispatchEvent(new Event("load"))
		})
		await flushAll()
		act(() => {
			dispatchContextPainted(iframeA, "r-1")
		})
		expect(iframeA.style.opacity).toBe("1")
		expect(result.current.presented).toBe(true)

		// Cross-plugin switch: the outgoing iframe is held — still claimed,
		// still opaque — while the incoming one is painted-but-transparent.
		rerender({ pluginId: "p-claim-b", resId: "r-2" })
		await flushAll()
		const iframeB = getIframe(container, 1)
		expect(result.current.presented).toBe(true)
		expect(iframeA.style.display).toBe("block")
		expect(iframeA.style.opacity).toBe("1")
		expect(iframeB.style.display).toBe("block")
		expect(iframeB.style.opacity).toBe("0")

		act(() => {
			iframeB.dispatchEvent(new Event("load"))
		})
		await flushAll()
		expect(iframeA.style.opacity).toBe("1")
		expect(iframeB.style.opacity).toBe("0")

		act(() => {
			dispatchContextPainted(iframeB, "r-2")
		})
		expect(iframeB.style.display).toBe("block")
		expect(iframeB.style.opacity).toBe("1")
		expect(iframeA.style.display).toBe("none")
		expect(result.current.presented).toBe(true)
	})

	it("flips to a pre-painted neighbor in the same commit (no ack wait)", async () => {
		cardPlugins = { "r-2": "p-flip-b" }
		const { container, wrapper } = setup()
		const { result, rerender } = renderHook(
			({ pluginId, resId }) =>
				usePluginIframeSlot({
					...slotOptions(pluginId, resId),
					neighbors: [{ resId: "r-2", pluginId: "p-flip-b" }],
				}),
			{
				wrapper,
				initialProps: { pluginId: "p-flip-a", resId: "r-1" },
			},
		)
		attachPlaceholder(result)
		const iframeA = getIframe(container, 0)
		const iframeB = getIframe(container, 1)
		expect(iframeA.title).toBe("plugin:p-flip-a")
		expect(iframeB.title).toBe("plugin:p-flip-b")

		// Paint both: the focused slot and the resident neighbor.
		act(() => {
			iframeA.dispatchEvent(new Event("load"))
			iframeB.dispatchEvent(new Event("load"))
		})
		await flushAll()
		act(() => {
			dispatchContextPainted(iframeA, "r-1")
			dispatchContextPainted(iframeB, "r-2")
		})
		// The neighbor is parked: painted, transparent, inert, one layer down.
		expect(iframeB.style.opacity).toBe("0")
		expect(iframeB.style.pointerEvents).toBe("none")

		// The switch flips presentation synchronously — the layout-effect
		// flipNow lands in the same commit as the chrome update, with no
		// microtask/ack wait in between.
		rerender({ pluginId: "p-flip-b", resId: "r-2" })
		expect(iframeB.style.opacity).toBe("1")
		expect(iframeB.style.pointerEvents).toBe("auto")
		expect(iframeA.style.opacity).toBe("0")
		expect(result.current.presented).toBe(true)
	})

	it("shows the iframe after a fallback delay when no ack arrives (legacy SDK)", async () => {
		vi.useFakeTimers()
		try {
			const { container, wrapper } = setup()
			const { result } = renderHook(
				() => usePluginIframeSlot(slotOptions("p-legacy", "r-1")),
				{ wrapper },
			)
			attachPlaceholder(result)
			const iframe = getIframe(container)
			act(() => {
				iframe.dispatchEvent(new Event("load"))
			})
			await flushAll()
			expect(iframe.style.opacity).toBe("0")

			// Window claims use the long prerender-grade fallback (5s), not
			// the pool's 300ms user-facing default.
			act(() => {
				vi.advanceTimersByTime(5_000)
			})
			expect(iframe.style.opacity).toBe("1")
		} finally {
			vi.useRealTimers()
		}
	})

	it("does not re-parent the inline iframe when readiness flips", async () => {
		const { wrapper } = setup()
		const placeholder = makePlaceholder({
			top: 0,
			left: 0,
			width: 100,
			height: 100,
		})
		// Re-parenting reloads the iframe's document in real browsers;
		// guard against readiness changes re-running the mount effect.
		const appendSpy = vi.spyOn(placeholder, "appendChild")
		const { result } = renderHook(
			() =>
				usePluginIframeSlot({
					...slotOptions("p-inline", "r-1"),
					inline: true,
				}),
			{ wrapper },
		)
		act(() => {
			result.current.ref(placeholder)
		})
		// Inline mode moves the iframe out of the pool container into the
		// placeholder.
		const iframe = placeholder.querySelector("iframe")
		if (iframe === null) throw new Error("no iframe in placeholder")
		act(() => {
			iframe.dispatchEvent(new Event("load"))
		})
		await flushAll()
		expect(appendSpy).toHaveBeenCalledTimes(1)

		act(() => {
			dispatchContextPainted(iframe, "r-1")
		})
		expect(appendSpy).toHaveBeenCalledTimes(1)
		expect(iframe.parentElement).toBe(placeholder)
		expect(iframe.style.opacity).toBe("1")
	})

	it("posts the inline context only after the post-re-parent load", async () => {
		const { container, wrapper } = setup()
		// Warm the pool: the primary entry is already loaded before the
		// inline slot claims it, so the pool-level whenLoaded() would
		// resolve immediately — exactly the case that used to post the
		// context into the document doomed by the re-parent reload.
		const warm = claim({ pluginId: "p-inline-warm" })
		act(() => {
			warm.iframe.dispatchEvent(new Event("load"))
		})
		warm.release()

		const placeholder = makePlaceholder({
			top: 0,
			left: 0,
			width: 100,
			height: 100,
		})
		const { result, unmount } = renderHook(
			() =>
				usePluginIframeSlot({
					...slotOptions("p-inline-warm", "r-1"),
					inline: true,
				}),
			{ wrapper },
		)
		act(() => {
			result.current.ref(placeholder)
		})
		// The warm iframe moved into the placeholder (a reload in real
		// browsers). Until the post-re-parent load fires, no context may
		// be posted. Note: jsdom hands out a NEW contentWindow across a
		// re-parent, so the spy must attach after the move.
		expect(placeholder.querySelector("iframe")).toBe(warm.iframe)
		const win = warm.iframe.contentWindow
		if (win === null) throw new Error("no contentWindow")
		const postSpy = vi.spyOn(win, "postMessage")
		await flushAll()
		expect(
			postSpy.mock.calls.filter(([msg]) => isContextPush(msg)),
		).toHaveLength(0)

		act(() => {
			warm.iframe.dispatchEvent(new Event("load"))
		})
		await flushAll()
		expect(
			postSpy.mock.calls.filter(([msg]) => isContextPush(msg)),
		).toHaveLength(1)

		// Cleanup detaches the iframe instead of re-parenting it back
		// into the pool container.
		unmount()
		expect(warm.iframe.isConnected).toBe(false)
		expect(container.querySelector("iframe")).toBeNull()
	})

	it("presents a primed slot immediately without re-posting the context", async () => {
		const { container, wrapper } = setup()
		// Simulate a previous window residency: claim, load, push the
		// context, ack, release — the entry goes back into the pool primed
		// for r-9.
		const pre = claim({ pluginId: "p-primed", resId: "r-9" })
		act(() => {
			pre.iframe.dispatchEvent(new Event("load"))
		})
		const win = pre.iframe.contentWindow
		if (win === null) throw new Error("no contentWindow")
		const postSpy = vi.spyOn(win, "postMessage")
		pre.postContext(
			buildPluginIframeContext({
				pluginId: "p-primed",
				resId: "r-9",
				resName: "nine",
				sourceMeta: undefined,
				contentPluginId: "p-primed",
			}),
		)
		act(() => {
			dispatchContextPainted(pre.iframe, "r-9")
		})
		pre.release()
		postSpy.mockClear()

		const { result } = renderHook(
			() => usePluginIframeSlot(slotOptions("p-primed", "r-9")),
			{ wrapper },
		)
		attachPlaceholder(result)
		const iframe = getIframe(container)
		expect(iframe).toBe(pre.iframe)
		// Primed: presented and opaque from the first effects — no ack wait.
		expect(result.current.presented).toBe(true)
		expect(iframe.style.opacity).toBe("1")
		await flushAll()
		// The primed entry already displays exactly this context: the
		// window must not push it again (which would re-mount the plugin
		// tree).
		expect(
			postSpy.mock.calls.filter(([msg]) => isContextPush(msg)),
		).toHaveLength(0)
	})
})
