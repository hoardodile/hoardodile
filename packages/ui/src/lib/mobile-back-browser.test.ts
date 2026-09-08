import { afterEach, describe, expect, it, vi } from "vitest"
import { getMobileBackController } from "./mobile-back-browser"

afterEach(() => vi.restoreAllMocks())

describe("browser mobile-back lifetime", () => {
	it("does not preempt the React error boundary when matchMedia throws at startup", async () => {
		vi.spyOn(window, "matchMedia").mockImplementation(() => {
			throw new Error("media unavailable")
		})
		const push = vi.spyOn(window.history, "pushState")
		const controller = getMobileBackController()
		controller.set({ id: "test", isOpen: () => true, close: vi.fn() })
		await Promise.resolve()
		expect(push).not.toHaveBeenCalled()
		controller.dispose()
	})

	it("shares one listener per window and releases the media subscription on disposal", () => {
		const add = vi.fn()
		const remove = vi.fn()
		vi.spyOn(window, "matchMedia").mockReturnValue({
			matches: false,
			media: "",
			onchange: null,
			addEventListener: add,
			removeEventListener: remove,
			addListener() {},
			removeListener() {},
			dispatchEvent: () => false,
		})
		const first = getMobileBackController()
		expect(getMobileBackController()).toBe(first)
		expect(add).toHaveBeenCalledTimes(1)
		first.dispose()
		expect(remove).toHaveBeenCalledTimes(1)
		const next = getMobileBackController()
		expect(next).not.toBe(first)
		next.dispose()
	})
})
