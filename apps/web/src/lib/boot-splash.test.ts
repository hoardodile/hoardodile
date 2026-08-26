import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { holdSplashUntilReady } from "./boot-splash"

function makeDeps(overrides?: {
	readonly initialFetching?: boolean
	readonly deadlineMs?: number
}) {
	const remove = vi.fn()
	const routerListeners: Array<() => void> = []
	const cacheListeners: Array<() => void> = []
	let fetching = overrides?.initialFetching ?? false
	const deps = {
		router: {
			subscribe: vi.fn((_event: "onResolved", callback: () => void) => {
				routerListeners.push(callback)
				return () => {
					const index = routerListeners.indexOf(callback)
					if (index >= 0) routerListeners.splice(index, 1)
				}
			}),
		},
		queryClient: {
			getQueryCache: vi.fn(() => ({
				subscribe: vi.fn((listener: () => void) => {
					cacheListeners.push(listener)
					return () => {
						const index = cacheListeners.indexOf(listener)
						if (index >= 0) cacheListeners.splice(index, 1)
					}
				}),
				getAll: vi.fn(() => [
					{ state: { fetchStatus: fetching ? "fetching" : "idle" } },
				]),
			})),
		},
		remove,
		deadlineMs: overrides?.deadlineMs ?? 5000,
	}
	return {
		deps,
		remove,
		routerListeners,
		cacheListeners,
		setFetching(next: boolean) {
			fetching = next
			for (const listener of [...cacheListeners]) listener()
		},
		resolveRouter() {
			for (const listener of [...routerListeners]) listener()
		},
	}
}

afterEach(() => {
	vi.useRealTimers()
})

describe("holdSplashUntilReady", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	it("removes the splash when the router resolves with no fetching queries", () => {
		const { deps, remove, resolveRouter } = makeDeps()
		holdSplashUntilReady(deps)
		expect(remove).not.toHaveBeenCalled()
		resolveRouter()
		expect(remove).toHaveBeenCalledTimes(1)
	})

	it("keeps the splash until every query settles", () => {
		const { deps, remove, resolveRouter, setFetching } = makeDeps({
			initialFetching: true,
		})
		holdSplashUntilReady(deps)
		resolveRouter()
		expect(remove).not.toHaveBeenCalled()
		setFetching(false)
		expect(remove).toHaveBeenCalledTimes(1)
	})

	it("never removes before the initial route resolved", () => {
		const { deps, remove, setFetching } = makeDeps()
		holdSplashUntilReady(deps)
		setFetching(false)
		expect(remove).not.toHaveBeenCalled()
	})

	it("forces removal at the deadline", () => {
		const { deps, remove } = makeDeps({ initialFetching: true })
		holdSplashUntilReady(deps)
		vi.advanceTimersByTime(5000)
		expect(remove).toHaveBeenCalledTimes(1)
	})

	it("removes only once, even when events repeat", () => {
		const { deps, remove, resolveRouter, setFetching } = makeDeps({
			initialFetching: true,
		})
		holdSplashUntilReady(deps)
		resolveRouter()
		setFetching(false)
		resolveRouter()
		setFetching(false)
		vi.advanceTimersByTime(5000)
		expect(remove).toHaveBeenCalledTimes(1)
	})
})
