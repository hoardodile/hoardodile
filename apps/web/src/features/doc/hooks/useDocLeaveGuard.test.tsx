import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useDocLeaveGuard } from "./useDocLeaveGuard"

vi.mock("@tanstack/react-router", () => ({
	useBlocker: vi.fn(),
}))

import { useBlocker } from "@tanstack/react-router"

type BlockLocation = {
	readonly pathname: string
	readonly search: unknown
}

type BlockerOpts = {
	shouldBlockFn: (args: {
		current: BlockLocation
		next: BlockLocation
	}) => boolean
	enableBeforeUnload: () => boolean
}

function lastBlockerOpts(): BlockerOpts {
	const call = vi.mocked(useBlocker).mock.calls.at(-1)?.[0]
	return call as unknown as BlockerOpts
}

/** Locations for a real navigation away from the guarded document page. */
function leavingArgs(): { current: BlockLocation; next: BlockLocation } {
	return {
		current: { pathname: "/documents/doc-1", search: {} },
		next: { pathname: "/documents", search: {} },
	}
}

beforeEach(() => {
	vi.mocked(useBlocker).mockClear()
})

describe("useDocLeaveGuard", () => {
	it("blocks navigation when dirty and the user cancels the system confirm", () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
		renderHook(() =>
			useDocLeaveGuard({ dirty: true, message: "Leave anyway?" }),
		)

		const opts = lastBlockerOpts()
		expect(opts.enableBeforeUnload()).toBe(true)
		expect(opts.shouldBlockFn(leavingArgs())).toBe(true)
		expect(confirmSpy).toHaveBeenCalledWith("Leave anyway?")

		confirmSpy.mockRestore()
	})

	it("allows navigation when dirty and the user confirms leave", () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
		renderHook(() =>
			useDocLeaveGuard({ dirty: true, message: "Leave anyway?" }),
		)

		const opts = lastBlockerOpts()
		expect(opts.shouldBlockFn(leavingArgs())).toBe(false)

		confirmSpy.mockRestore()
	})

	it("does not block or confirm when there are no unsaved changes", () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
		renderHook(() =>
			useDocLeaveGuard({ dirty: false, message: "Leave anyway?" }),
		)

		const opts = lastBlockerOpts()
		expect(opts.enableBeforeUnload()).toBe(false)
		expect(opts.shouldBlockFn(leavingArgs())).toBe(false)
		expect(confirmSpy).not.toHaveBeenCalled()

		confirmSpy.mockRestore()
	})

	it("allows same-location history pops without confirming (mobile overlay close)", () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
		renderHook(() =>
			useDocLeaveGuard({ dirty: true, message: "Leave anyway?" }),
		)

		const opts = lastBlockerOpts()
		const sameLocation = {
			current: { pathname: "/documents/doc-1", search: { filter: "x" } },
			next: { pathname: "/documents/doc-1", search: { filter: "x" } },
		}
		expect(opts.shouldBlockFn(sameLocation)).toBe(false)
		expect(confirmSpy).not.toHaveBeenCalled()

		confirmSpy.mockRestore()
	})

	it("still blocks when only the search params change", () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
		renderHook(() =>
			useDocLeaveGuard({ dirty: true, message: "Leave anyway?" }),
		)

		const opts = lastBlockerOpts()
		const searchChanged = {
			current: { pathname: "/documents/doc-1", search: {} },
			next: { pathname: "/documents/doc-1", search: { filter: "x" } },
		}
		expect(opts.shouldBlockFn(searchChanged)).toBe(true)

		confirmSpy.mockRestore()
	})
})
