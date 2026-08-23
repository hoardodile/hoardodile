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
import { useRouteScrollRestore } from "./useRouteScrollRestore"

const PREFIX = "hoardodile.scroll"

function makeContainer() {
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
	const scrollTo = vi.fn((options: { top: number }) => {
		layout.scrollTop = Math.max(0, options.top)
	})
	Object.defineProperty(container, "scrollTo", {
		writable: true,
		configurable: true,
		value: scrollTo,
	})
	return { container, layout, scrollTo }
}

function renderWithHook(initialPath = "/", options?: { strict?: boolean }) {
	const fixture = makeContainer()
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

	it("flushes the exact position when leaving a tracked route", async () => {
		const { fixture, router } = renderWithHook()
		await flushFrames()
		fixture.layout.scrollTop = 123
		await act(async () => {
			await router.navigate({ to: "/documents" })
		})
		expect(sessionStorage.getItem(`${PREFIX}:/`)).toBe("123")
	})

	it("does not restore routes that manage their own position", async () => {
		const { fixture, router } = renderWithHook()
		await flushFrames()
		fixture.scrollTo.mockClear()
		await act(async () => {
			await router.navigate({
				to: "/documents/$id",
				params: { id: "doc-1" },
			})
		})
		expect(fixture.scrollTo).not.toHaveBeenCalled()
	})
})
