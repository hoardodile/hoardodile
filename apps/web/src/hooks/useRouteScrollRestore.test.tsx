import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router"
import { act, render } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as routeScrollRestore from "@/lib/routeScrollRestore"
import { useRouteScrollRestore } from "./useRouteScrollRestore"

const PREFIX = "hoardodile.scroll"

vi.mock("@/lib/routeScrollRestore", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/routeScrollRestore")>()
	return {
		...actual,
		writeRouteScroll: vi.fn(actual.writeRouteScroll),
	}
})

function makeContainer(options?: { readonly clamp?: boolean }) {
	const clamp = options?.clamp === true
	const container = document.createElement("div")
	container.setAttribute("data-app-scroll", "")
	document.body.appendChild(container)
	// jsdom 30 does not implement element scroll methods or layout, so the
	// fixture owns a mutable layout and the element reads through it.
	const layout = { scrollTop: 0, scrollHeight: 800, clientHeight: 400 }
	Object.defineProperties(container, {
		scrollTop: {
			get: () => layout.scrollTop,
			set: (value: number) => {
				layout.scrollTop = value
			},
			configurable: true,
		},
		scrollHeight: { get: () => layout.scrollHeight, configurable: true },
		clientHeight: { get: () => layout.clientHeight, configurable: true },
	})
	const scrollTo = vi.fn((scrollOptions: { top: number }) => {
		// A real browser clamps scrollTo to the current max and fires a
		// scroll event afterwards; the default fixture lets the target land
		// verbatim. `clamp` opts into the browser behavior so the restore
		// loop's self-clamp handling can be exercised.
		const max = Math.max(layout.scrollHeight - layout.clientHeight, 0)
		layout.scrollTop = Math.max(0, Math.min(scrollOptions.top, max))
		if (clamp) {
			queueMicrotask(() => container.dispatchEvent(new Event("scroll")))
		}
	})
	Object.defineProperty(container, "scrollTo", {
		writable: true,
		configurable: true,
		value: scrollTo,
	})
	return { container, layout, scrollTo }
}

function renderWithHook(
	initialPath = "/",
	options?: { readonly strict?: boolean; readonly clamp?: boolean },
) {
	const fixture = makeContainer({ clamp: options?.clamp })
	const rootRoute = createRootRoute({
		component: () => {
			useRouteScrollRestore()
			return null
		},
	})
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => null,
	})
	const documentsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/documents",
		component: () => null,
	})
	const docReaderRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/documents/$id",
		component: () => null,
	})
	const router = createRouter({
		routeTree: rootRoute.addChildren([
			indexRoute,
			documentsRoute,
			docReaderRoute,
		]),
		history: createMemoryHistory({ initialEntries: [initialPath] }),
	})
	const tree = <RouterProvider router={router} />
	render(options?.strict === true ? <StrictMode>{tree}</StrictMode> : tree)
	return { fixture, router }
}

/**
 * Advance fake time by the given number of frames. The router's initial
 * navigation is async and its load consumes the first advance, so callers
 * pass enough frames to get past the mount before asserting on ticks.
 */
async function flushFrames(count = 4) {
	for (let i = 0; i < count; i += 1) {
		await act(async () => {
			vi.advanceTimersByTime(16)
		})
	}
}

/** Browser-history back/forward via the router's history instance. */
async function traverseHistory(
	router: { history: { back: () => void; forward: () => void } },
	delta: -1 | 1,
) {
	await act(async () => {
		if (delta === -1) router.history.back()
		else router.history.forward()
	})
}

beforeEach(() => {
	vi.useFakeTimers({
		toFake: [
			"setTimeout",
			"clearTimeout",
			"setInterval",
			"clearInterval",
			"requestAnimationFrame",
			"cancelAnimationFrame",
			"Date",
		],
	})
	sessionStorage.clear()
	vi.mocked(routeScrollRestore.writeRouteScroll).mockClear()
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
	document.body.innerHTML = ""
	sessionStorage.clear()
})

describe("useRouteScrollRestore", () => {
	it("restores the stored position once the content can hold it", async () => {
		sessionStorage.setItem(`${PREFIX}:/`, "300")
		const { fixture } = renderWithHook()
		await flushFrames()
		expect(fixture.scrollTo).toHaveBeenLastCalledWith({
			top: 300,
			behavior: "instant",
		})
	})

	it("keeps re-aligning while the content grows after a long stable skeleton", async () => {
		sessionStorage.setItem(`${PREFIX}:/`, "300")
		const { fixture } = renderWithHook()
		// A long stable skeleton (~1s): the old fixed-frame loop would have
		// stopped at the clamped 50 within a few frames.
		fixture.layout.scrollHeight = 450
		await flushFrames(60)
		expect(fixture.scrollTo).toHaveBeenLastCalledWith({
			top: 50,
			behavior: "instant",
		})
		// The real content lands and grows past the target: the loop must
		// still be alive and re-align onto it.
		fixture.layout.scrollHeight = 1400
		await flushFrames(5)
		expect(fixture.scrollTo).toHaveBeenLastCalledWith({
			top: 300,
			behavior: "instant",
		})
	})

	it("clamps to the max scroll when the page is shorter than the target", async () => {
		sessionStorage.setItem(`${PREFIX}:/`, "300")
		const { fixture } = renderWithHook()
		fixture.layout.scrollHeight = 450
		// The page is genuinely short: the loop ends only after ~1.5s of an
		// unchanged height (~90 frames).
		await flushFrames(96)
		expect(fixture.scrollTo).toHaveBeenLastCalledWith({
			top: 50,
			behavior: "instant",
		})
	})

	it("re-applies after a route swap clamps the position", async () => {
		sessionStorage.setItem(`${PREFIX}:/`, "300")
		const { fixture } = renderWithHook()
		// The outgoing page is taller than the target, so the first tick
		// looks "landed"; simulate the swap shrinking the content and the
		// browser clamping the scrollTop back.
		await flushFrames(2)
		fixture.layout.scrollHeight = 400
		fixture.layout.scrollTop = 0
		await flushFrames(2)
		expect(fixture.scrollTo).toHaveBeenLastCalledWith({
			top: 0,
			behavior: "instant",
		})
		// The real content grows past the target: the loop re-aligns.
		fixture.layout.scrollHeight = 1400
		await flushFrames(5)
		expect(fixture.scrollTo).toHaveBeenLastCalledWith({
			top: 300,
			behavior: "instant",
		})
	})

	it("does not cancel its own clamp: the browser's scrollTo clamping fires a scroll event", async () => {
		sessionStorage.setItem(`${PREFIX}:/`, "300")
		const { fixture } = renderWithHook("/", { clamp: true })
		// The page is short: every scrollTo(300) is clamped to 50 and fires
		// a scroll event. The loop must keep re-aligning instead of treating
		// its own clamped position as a user scroll and cancelling.
		fixture.layout.scrollHeight = 450
		await flushFrames(65)
		expect(fixture.scrollTo).toHaveBeenLastCalledWith({
			top: 50,
			behavior: "instant",
		})
		// Content grows past the target: the loop survived the clamp and
		// re-aligns onto the stored position.
		fixture.layout.scrollHeight = 1400
		await flushFrames(5)
		expect(fixture.scrollTo).toHaveBeenLastCalledWith({
			top: 300,
			behavior: "instant",
		})
	})

	it("scrolls to the top when the route has no stored position", async () => {
		const { fixture } = renderWithHook()
		await flushFrames()
		expect(fixture.scrollTo).toHaveBeenCalledWith({
			top: 0,
			behavior: "instant",
		})
	})

	it("does not write interim positions while a restore is settling", async () => {
		sessionStorage.setItem(`${PREFIX}:/`, "300")
		const { fixture } = renderWithHook()
		fixture.layout.scrollHeight = 400
		// Two advances: the async mount, then the first restore tick — the
		// restore is still in flight (target unreachable, height settling).
		await flushFrames(2)
		// A scroll right now must not overwrite the slot with the clamped
		// interim position.
		fixture.container.dispatchEvent(new Event("scroll"))
		await flushFrames(20)
		expect(sessionStorage.getItem(`${PREFIX}:/`)).toBe("300")
	})

	it("stops restoring when the user scrolls away", async () => {
		sessionStorage.setItem(`${PREFIX}:/`, "300")
		const { fixture } = renderWithHook()
		fixture.layout.scrollHeight = 400
		await flushFrames(2)
		fixture.scrollTo.mockClear()
		// A manual scroll mid-restore wins: the retry loop must stop even
		// if the content grows afterwards.
		fixture.layout.scrollTop = 42
		fixture.container.dispatchEvent(new Event("scroll"))
		fixture.layout.scrollHeight = 800
		await flushFrames(20)
		expect(fixture.scrollTo).not.toHaveBeenCalled()
	})

	it("restores on the second StrictMode mount", async () => {
		sessionStorage.setItem(`${PREFIX}:/`, "300")
		// StrictMode (dev) runs the effect, tears it down and runs it again:
		// the cached route must be cleared so the second mount still applies
		// and restores, instead of skipping it as a no-op.
		const { fixture } = renderWithHook("/", { strict: true })
		await flushFrames()
		expect(fixture.scrollTo).toHaveBeenLastCalledWith({
			top: 300,
			behavior: "instant",
		})
	})

	it("pushes to a route with a stored position reset to the top", async () => {
		// A stored position from an earlier visit must not resurrect on a
		// forward navigation: only back restores.
		sessionStorage.setItem(`${PREFIX}:/documents`, "300")
		const { fixture, router } = renderWithHook()
		await flushFrames()
		fixture.scrollTo.mockClear()
		await act(async () => {
			await router.navigate({ to: "/documents" })
		})
		expect(fixture.scrollTo).toHaveBeenLastCalledWith({
			top: 0,
			behavior: "instant",
		})
		// The stored value survives: a later back to the route restores it.
		expect(sessionStorage.getItem(`${PREFIX}:/documents`)).toBe("300")
	})

	it("restores on back and resets on forward", async () => {
		sessionStorage.setItem(`${PREFIX}:/`, "300")
		const { fixture, router } = renderWithHook()
		await flushFrames(35)
		await act(async () => {
			await router.navigate({ to: "/documents" })
		})
		// The user scrolls the pushed route and leaves it.
		fixture.layout.scrollTop = 150
		fixture.scrollTo.mockClear()
		await traverseHistory(router, -1)
		await flushFrames(35)
		expect(sessionStorage.getItem(`${PREFIX}:/documents`)).toBe("150")
		expect(fixture.scrollTo).toHaveBeenLastCalledWith({
			top: 300,
			behavior: "instant",
		})
		// Forward returns to the top — no stale restore.
		fixture.scrollTo.mockClear()
		await traverseHistory(router, 1)
		expect(fixture.scrollTo).toHaveBeenLastCalledWith({
			top: 0,
			behavior: "instant",
		})
	})

	it("resets to the top on a same-index replace to a new route", async () => {
		sessionStorage.setItem(`${PREFIX}:/documents`, "300")
		const { fixture, router } = renderWithHook()
		await flushFrames()
		fixture.scrollTo.mockClear()
		await act(async () => {
			await router.navigate({ to: "/documents", replace: true })
		})
		expect(fixture.scrollTo).toHaveBeenLastCalledWith({
			top: 0,
			behavior: "instant",
		})
	})

	it("does not overwrite the stored position when a push resets the container", async () => {
		sessionStorage.setItem(`${PREFIX}:/`, "300")
		const { fixture, router } = renderWithHook()
		await flushFrames(35)
		await act(async () => {
			await router.navigate({ to: "/documents" })
		})
		// The browser fires the async scroll event of our programmatic reset:
		// it must not record the reset position over the stored "/" value,
		// or the next back-restore would come back empty.
		fixture.layout.scrollTop = 0
		fixture.container.dispatchEvent(new Event("scroll"))
		await flushFrames(3)
		expect(sessionStorage.getItem(`${PREFIX}:/`)).toBe("300")
		// A genuine user scroll still records (and re-arms the writer); 17
		// frames ≈ 270ms gets past the 250ms throttle window.
		fixture.layout.scrollTop = 123
		fixture.container.dispatchEvent(new Event("scroll"))
		await flushFrames(17)
		expect(sessionStorage.getItem(`${PREFIX}:/documents`)).toBe("123")
	})

	it("leaves the position alone when the route does not change", async () => {
		const { fixture, router } = renderWithHook("/documents")
		await flushFrames()
		fixture.scrollTo.mockClear()
		await act(async () => {
			await router.navigate({ to: "/documents" })
		})
		expect(fixture.scrollTo).not.toHaveBeenCalled()
	})

	it("flushes the exact position when leaving a tracked route", async () => {
		const { fixture, router } = renderWithHook()
		await flushFrames()
		fixture.layout.scrollTop = 123
		await act(async () => {
			await router.navigate({ to: "/documents" })
		})
		expect(sessionStorage.getItem(`${PREFIX}:/`)).toBe("123")
	})

	it("flushes the outgoing position before resetting the container", async () => {
		const { fixture, router } = renderWithHook()
		await flushFrames()
		fixture.layout.scrollTop = 123
		fixture.scrollTo.mockClear()
		await act(async () => {
			await router.navigate({ to: "/documents" })
		})
		// The leave flush (onBeforeLoad — the outgoing page is still
		// mounted) must precede any scroll movement of the incoming route.
		const writeCall = vi
			.mocked(routeScrollRestore.writeRouteScroll)
			.mock.calls.find(([key]) => key === `${PREFIX}:/`)
		expect(writeCall).toEqual([`${PREFIX}:/`, 123])
		const writeOrder = vi
			.mocked(routeScrollRestore.writeRouteScroll)
			.mock.invocationCallOrder.slice(0, 1)[0]
		expect(writeOrder).toBeLessThan(
			fixture.scrollTo.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
		)
	})

	it("resets to the top when navigating to a route that manages its own position", async () => {
		// The route's own manager (doc reader, plugin reader) owns the
		// position, but the container must not inherit the outgoing page's
		// scrollTop — a fresh arrival starts at the top.
		const { fixture, router } = renderWithHook()
		await flushFrames()
		fixture.scrollTo.mockClear()
		await act(async () => {
			await router.navigate({
				to: "/documents/$id",
				params: { id: "doc-1" },
			})
		})
		expect(fixture.scrollTo).toHaveBeenLastCalledWith({
			top: 0,
			behavior: "instant",
		})
	})

	it("resets to the top when returning back to a route that manages its own position", async () => {
		const { fixture, router } = renderWithHook()
		await flushFrames()
		await act(async () => {
			await router.navigate({
				to: "/documents/$id",
				params: { id: "doc-1" },
			})
		})
		// Leave the untracked route for a tracked one, then come back.
		await act(async () => {
			await router.navigate({ to: "/documents" })
		})
		fixture.scrollTo.mockClear()
		await traverseHistory(router, -1)
		expect(fixture.scrollTo).toHaveBeenLastCalledWith({
			top: 0,
			behavior: "instant",
		})
	})
})
