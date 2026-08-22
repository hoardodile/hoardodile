import type { PluginIframeContext } from "@hoardodile/sdk-web"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PoolClaimedEntry } from "./iframe-pool"
import {
	createPreviewWindow,
	type PreviewWindowItem,
	type PreviewWindowNeighbor,
} from "./preview-window"

// The pool is mocked: every claim hands back a controllable slot mirroring
// the pool's onReady contract (fires at most once, replays synchronously
// to late subscribers) — the same mock shape slot-transition.test.ts used.
const claimMock = vi.fn()

vi.mock("./iframe-pool", () => ({
	claim: (...args: unknown[]) => claimMock(...args),
}))

function makeSlot(primedResId?: string) {
	const readyCallbacks = new Set<() => void>()
	let ready = primedResId !== undefined
	const slot: PoolClaimedEntry = {
		iframe: document.createElement("iframe"),
		primedResId,
		release: vi.fn(),
		postContext: vi.fn(),
		setVisibility: vi.fn(),
		onLoaded: () => () => {},
		whenLoaded: () => Promise.resolve(),
		onReady: vi.fn((cb: () => void) => {
			if (ready) {
				cb()
				return () => {}
			}
			readyCallbacks.add(cb)
			return () => {
				readyCallbacks.delete(cb)
			}
		}),
	}
	function fireReady(): void {
		if (ready) return
		ready = true
		for (const cb of [...readyCallbacks]) {
			cb()
		}
		readyCallbacks.clear()
	}
	return { slot, fireReady }
}

/** Queue the slot the next claim() call hands back, in claim order. */
function queueClaim(primedResId?: string) {
	const made = makeSlot(primedResId)
	claimMock.mockImplementationOnce(() => made.slot)
	return made
}

function makeContext(resId: string): PluginIframeContext {
	return {
		pluginId: "p-1",
		resId,
		resName: `name-${resId}`,
		sourceMeta: undefined,
		searchMeta: undefined,
		fileStats: undefined,
		contentPluginId: "p-1",
		language: "en",
		resolvedTheme: "dark",
		palette: "mono",
		iconStyle: "duotone",
		fonts: { family: "", cssPaths: [] },
		initialPrefs: {},
		initialCache: {},
		fileToken: "tok",
	}
}

const loadContextMock = vi.fn((item: PreviewWindowItem) =>
	Promise.resolve(makeContext(item.resId)),
)
const loadNeighborContextMock = vi.fn((neighbor: PreviewWindowNeighbor) =>
	Promise.resolve(makeContext(neighbor.resId)),
)

function makeItem(resId: string, pluginId = "p-1"): PreviewWindowItem {
	return {
		resId,
		resName: `name-${resId}`,
		contentPluginId: pluginId,
		sourceMeta: undefined,
		pluginId,
	}
}

function setup() {
	const window = createPreviewWindow({
		getAssetVersion: () => "v1",
		loadContext: loadContextMock,
		loadNeighborContext: loadNeighborContextMock,
		zTop: 1001,
	})
	return window
}

// The context push chains the loader promise through Promise.all with
// whenLoaded, so one microtask round is not enough.
async function flush(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await Promise.resolve()
	}
}

afterEach(() => {
	claimMock.mockReset()
	loadContextMock.mockClear()
	loadNeighborContextMock.mockClear()
})

describe("createPreviewWindow", () => {
	it("focus claims the focused item and its neighbors and posts their contexts", async () => {
		const a = queueClaim()
		const b = queueClaim()
		const c = queueClaim()
		const window = setup()

		window.focus(makeItem("r-a", "p-a"), [
			{ resId: "r-b", pluginId: "p-b" },
			{ resId: "r-c", pluginId: "p-a" },
		])

		expect(claimMock).toHaveBeenCalledTimes(3)
		// Focused claim: no ackTimeoutMs override — the pool's user-facing
		// 300ms default applies. Neighbors get the 5s background window.
		expect(claimMock).toHaveBeenNthCalledWith(1, {
			pluginId: "p-a",
			assetVersion: "v1",
			resId: "r-a",
			ackTimeoutMs: undefined,
		})
		expect(claimMock).toHaveBeenNthCalledWith(2, {
			pluginId: "p-b",
			assetVersion: "v1",
			resId: "r-b",
			ackTimeoutMs: 5000,
		})

		await flush()

		// The focused item goes through loadContext, neighbors through
		// loadNeighborContext; each slot received exactly its own context.
		expect(loadContextMock).toHaveBeenCalledTimes(1)
		expect(loadNeighborContextMock).toHaveBeenCalledTimes(2)
		expect(a.slot.postContext).toHaveBeenCalledWith(makeContext("r-a"))
		expect(b.slot.postContext).toHaveBeenCalledWith(makeContext("r-b"))
		expect(c.slot.postContext).toHaveBeenCalledWith(makeContext("r-c"))

		const snapshot = window.getSnapshot()
		expect(snapshot.focusedResId).toBe("r-a")
		expect(snapshot.slots.map((s) => s.resId)).toEqual(["r-a", "r-b", "r-c"])
		expect(snapshot.focusedReady).toBe(false)
		expect(snapshot.presentedResId).toBeNull()
	})

	it("a primed claim is instantly ready, presented, and skips the context post", () => {
		const a = queueClaim("r-a")
		const window = setup()

		window.focus(makeItem("r-a"), [])

		const snapshot = window.getSnapshot()
		expect(snapshot.focusedReady).toBe(true)
		expect(snapshot.presentedResId).toBe("r-a")
		expect(a.slot.postContext).not.toHaveBeenCalled()
		expect(loadContextMock).not.toHaveBeenCalled()
		expect(a.slot.iframe.style.opacity).toBe("1")
		expect(a.slot.iframe.style.pointerEvents).toBe("auto")
		expect(a.slot.iframe.style.zIndex).toBe("1001")
	})

	it("presents the focused slot when its paint ack lands", () => {
		const a = queueClaim()
		const window = setup()
		window.focus(makeItem("r-a"), [])
		expect(window.getSnapshot().presentedResId).toBeNull()

		a.fireReady()

		expect(window.getSnapshot().presentedResId).toBe("r-a")
		expect(a.slot.iframe.style.opacity).toBe("1")
		expect(a.slot.setVisibility).toHaveBeenLastCalledWith(true)
	})

	it("presents an unpainted focused slot after the 300ms user-facing fallback and swallows the late ack", () => {
		vi.useFakeTimers()
		try {
			const a = queueClaim()
			const window = setup()
			window.focus(makeItem("r-a"), [])
			expect(window.getSnapshot().presentedResId).toBeNull()

			vi.advanceTimersByTime(299)
			expect(window.getSnapshot().presentedResId).toBeNull()
			vi.advanceTimersByTime(1)
			expect(window.getSnapshot().presentedResId).toBe("r-a")
			expect(a.slot.iframe.style.opacity).toBe("1")

			// The late real ack is a no-op: still presented, no re-notify
			// (the snapshot is referentially stable between notifies).
			const before = window.getSnapshot()
			a.fireReady()
			expect(window.getSnapshot()).toBe(before)
		} finally {
			vi.useRealTimers()
		}
	})

	it("clears a pending focus fallback on dispose", () => {
		vi.useFakeTimers()
		try {
			const a = queueClaim()
			const window = setup()
			window.focus(makeItem("r-a"), [])
			expect(vi.getTimerCount()).toBe(1)

			window.dispose()

			expect(a.slot.release).toHaveBeenCalled()
			expect(vi.getTimerCount()).toBe(0)
			vi.advanceTimersByTime(1_000)
			expect(window.getSnapshot().presentedResId).toBeNull()
		} finally {
			vi.useRealTimers()
		}
	})

	it("flipNow presents a ready slot synchronously; returns false otherwise", () => {
		const a = queueClaim()
		const b = queueClaim()
		const window = setup()
		window.focus(makeItem("r-a"), [{ resId: "r-b", pluginId: "p-b" }])
		a.fireReady()
		b.fireReady()

		// Unknown resId: no flip.
		expect(window.flipNow("r-x")).toBe(false)
		expect(window.getSnapshot().presentedResId).toBe("r-a")

		// Ready neighbor: synchronous style flip, no display toggling.
		expect(window.flipNow("r-b")).toBe(true)
		expect(window.getSnapshot().presentedResId).toBe("r-b")
		expect(b.slot.iframe.style.opacity).toBe("1")
		expect(b.slot.iframe.style.pointerEvents).toBe("auto")
		expect(b.slot.iframe.style.zIndex).toBe("1001")
		expect(a.slot.iframe.style.opacity).toBe("0")
		expect(a.slot.iframe.style.pointerEvents).toBe("none")
		expect(a.slot.iframe.style.zIndex).toBe("1000")

		// Already presented: still true, nothing changes.
		expect(window.flipNow("r-b")).toBe(true)
		expect(window.getSnapshot().presentedResId).toBe("r-b")
	})

	it("flipNow returns false for a slot that is claimed but not yet ready", () => {
		queueClaim()
		const b = queueClaim()
		const window = setup()
		window.focus(makeItem("r-a"), [{ resId: "r-b", pluginId: "p-b" }])

		expect(window.flipNow("r-b")).toBe(false)
		expect(window.getSnapshot().presentedResId).toBeNull()
		expect(b.slot.setVisibility).toHaveBeenLastCalledWith(false)
	})

	it("keeps the previous slot presented until the focused slot is ready (held)", () => {
		const a = queueClaim()
		const window = setup()
		window.focus(makeItem("r-a"), [])
		a.fireReady()
		expect(window.getSnapshot().presentedResId).toBe("r-a")

		// Focus moves to r-b (not in the window): r-a falls out of the
		// wanted set but stays claimed and presented — the user keeps
		// seeing it while r-b readies.
		const b = queueClaim()
		window.focus(makeItem("r-b", "p-b"), [])
		expect(a.slot.release).not.toHaveBeenCalled()
		expect(window.getSnapshot().presentedResId).toBe("r-a")
		expect(a.slot.iframe.style.opacity).toBe("1")
		expect(b.slot.iframe.style.opacity).toBe("0")

		// The ack flips presentation and releases the held slot.
		b.fireReady()
		expect(window.getSnapshot().presentedResId).toBe("r-b")
		expect(b.slot.iframe.style.opacity).toBe("1")
		expect(a.slot.release).toHaveBeenCalledTimes(1)
	})

	it("releases slots that fall out of the window when focus slides", () => {
		const a = queueClaim()
		const b = queueClaim()
		const c = queueClaim()
		const window = setup()
		window.focus(makeItem("r-a"), [
			{ resId: "r-b", pluginId: "p-b" },
			{ resId: "r-c", pluginId: "p-c" },
		])

		// Nothing was ever presented, so dropping all three releases them
		// immediately (no hold without an on-screen slot).
		const d = queueClaim()
		window.focus(makeItem("r-d", "p-d"), [])
		expect(a.slot.release).toHaveBeenCalledTimes(1)
		expect(b.slot.release).toHaveBeenCalledTimes(1)
		expect(c.slot.release).toHaveBeenCalledTimes(1)
		expect(window.getSnapshot().slots.map((s) => s.resId)).toEqual(["r-d"])
		expect(d.slot.release).not.toHaveBeenCalled()
	})

	it("pushes visibility true to the presented slot and false to all others", () => {
		const a = queueClaim()
		const b = queueClaim()
		const c = queueClaim()
		const window = setup()
		window.focus(makeItem("r-a"), [
			{ resId: "r-b", pluginId: "p-b" },
			{ resId: "r-c", pluginId: "p-c" },
		])
		a.fireReady()
		b.fireReady()
		c.fireReady()

		window.flipNow("r-b")
		expect(a.slot.setVisibility).toHaveBeenLastCalledWith(false)
		expect(b.slot.setVisibility).toHaveBeenLastCalledWith(true)
		expect(c.slot.setVisibility).toHaveBeenLastCalledWith(false)

		window.flipNow("r-c")
		expect(b.slot.setVisibility).toHaveBeenLastCalledWith(false)
		expect(c.slot.setVisibility).toHaveBeenLastCalledWith(true)
	})

	it("re-focusing an already-claimed resId neither re-claims nor re-posts", async () => {
		const a = queueClaim()
		const window = setup()
		window.focus(makeItem("r-a"), [])
		await flush()

		window.focus(makeItem("r-a"), [])
		await flush()

		expect(claimMock).toHaveBeenCalledTimes(1)
		expect(a.slot.postContext).toHaveBeenCalledTimes(1)
	})

	it("ignores a stale ack after the slot was released", () => {
		const a = queueClaim()
		const window = setup()
		window.focus(makeItem("r-a"), [])

		queueClaim()
		window.focus(makeItem("r-b", "p-b"), [])
		expect(a.slot.release).toHaveBeenCalledTimes(1)

		// r-a's late ack must not flip anything.
		a.fireReady()
		expect(window.getSnapshot().presentedResId).toBeNull()
		expect(window.getSnapshot().focusedReady).toBe(false)
	})

	it("releases the claim silently when the neighbor context fails to load", async () => {
		const a = queueClaim()
		const b = queueClaim()
		loadNeighborContextMock.mockImplementationOnce(() =>
			Promise.reject(new Error("card fetch failed")),
		)
		const window = setup()
		window.focus(makeItem("r-a"), [{ resId: "r-b", pluginId: "p-b" }])
		await flush()

		expect(b.slot.release).toHaveBeenCalledTimes(1)
		expect(window.getSnapshot().slots.map((s) => s.resId)).toEqual(["r-a"])
		// The focused slot is unaffected.
		expect(a.slot.release).not.toHaveBeenCalled()
	})

	it("ignores a context that resolves after its slot was released", async () => {
		let resolveContext: ((ctx: PluginIframeContext) => void) | undefined
		loadNeighborContextMock.mockImplementationOnce(
			() =>
				new Promise<PluginIframeContext>((resolve) => {
					resolveContext = resolve
				}),
		)
		const a = queueClaim()
		const b = queueClaim()
		const window = setup()
		window.focus(makeItem("r-a"), [{ resId: "r-b", pluginId: "p-b" }])

		// The window slides r-b out before its context arrives.
		queueClaim()
		window.focus(makeItem("r-c", "p-c"), [])
		expect(b.slot.release).toHaveBeenCalledTimes(1)

		resolveContext?.(makeContext("r-b"))
		await flush()
		expect(b.slot.postContext).not.toHaveBeenCalled()
		expect(a.slot.release).toHaveBeenCalledTimes(1)
	})

	it("notifies subscribers on focus, ack, and flip with a stable snapshot between", () => {
		const a = queueClaim()
		const b = queueClaim()
		const window = setup()
		const listener = vi.fn()
		const unsubscribe = window.subscribe(listener)

		window.focus(makeItem("r-a"), [{ resId: "r-b", pluginId: "p-b" }])
		expect(listener).toHaveBeenCalledTimes(1)
		// getSnapshot between notifies returns the identical object.
		expect(window.getSnapshot()).toBe(window.getSnapshot())

		a.fireReady()
		expect(listener).toHaveBeenCalledTimes(2)
		b.fireReady()
		expect(listener).toHaveBeenCalledTimes(3)
		window.flipNow("r-b")
		expect(listener).toHaveBeenCalledTimes(4)
		// Flipping to the already-presented slot does not notify.
		window.flipNow("r-b")
		expect(listener).toHaveBeenCalledTimes(4)

		unsubscribe()
		window.flipNow("r-a")
		expect(listener).toHaveBeenCalledTimes(4)
	})

	it("dispose releases every claim", () => {
		const a = queueClaim()
		const b = queueClaim()
		const window = setup()
		window.focus(makeItem("r-a"), [{ resId: "r-b", pluginId: "p-b" }])
		a.fireReady()

		window.dispose()

		expect(a.slot.release).toHaveBeenCalledTimes(1)
		expect(b.slot.release).toHaveBeenCalledTimes(1)
		expect(window.getSnapshot().slots).toEqual([])
		expect(window.getSnapshot().presentedResId).toBeNull()
	})
})
