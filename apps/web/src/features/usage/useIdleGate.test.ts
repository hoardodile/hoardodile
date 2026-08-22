import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { USAGE_IDLE_TIMEOUT_MS, useIdleGate } from "./useIdleGate"

describe("useIdleGate", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("starts active and becomes idle after timeout", () => {
		const { result } = renderHook(() => useIdleGate(1_000))

		expect(result.current).toBe(false)

		act(() => {
			vi.advanceTimersByTime(1_000)
		})

		expect(result.current).toBe(true)
	})

	it("resets idle timer on user activity", () => {
		const { result } = renderHook(() => useIdleGate(USAGE_IDLE_TIMEOUT_MS))

		act(() => {
			vi.advanceTimersByTime(USAGE_IDLE_TIMEOUT_MS - 1_000)
		})
		expect(result.current).toBe(false)

		act(() => {
			window.dispatchEvent(new Event("keydown"))
		})

		act(() => {
			vi.advanceTimersByTime(USAGE_IDLE_TIMEOUT_MS - 1_000)
		})
		expect(result.current).toBe(false)

		act(() => {
			vi.advanceTimersByTime(1_000)
		})
		expect(result.current).toBe(true)
	})
})
