import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { useDebouncedValue } from "./useDebouncedValue"

describe("useDebouncedValue", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test("returns the initial value immediately", () => {
		const { result } = renderHook(() => useDebouncedValue("seed", 250))
		expect(result.current).toBe("seed")
	})

	test("withholds the new value until the delay elapses", () => {
		const { result, rerender } = renderHook(
			({ value }: { value: string }) => useDebouncedValue(value, 250),
			{ initialProps: { value: "first" } },
		)
		rerender({ value: "second" })
		expect(result.current).toBe("first")
		act(() => {
			vi.advanceTimersByTime(249)
		})
		expect(result.current).toBe("first")
		act(() => {
			vi.advanceTimersByTime(1)
		})
		expect(result.current).toBe("second")
	})

	test("collapses rapid changes within the window to the latest value", () => {
		const { result, rerender } = renderHook(
			({ value }: { value: string }) => useDebouncedValue(value, 250),
			{ initialProps: { value: "a" } },
		)
		rerender({ value: "ab" })
		act(() => {
			vi.advanceTimersByTime(100)
		})
		rerender({ value: "abc" })
		act(() => {
			vi.advanceTimersByTime(100)
		})
		rerender({ value: "abcd" })
		act(() => {
			vi.advanceTimersByTime(250)
		})
		expect(result.current).toBe("abcd")
	})

	test("cancels pending updates on unmount", () => {
		const { result, rerender, unmount } = renderHook(
			({ value }: { value: string }) => useDebouncedValue(value, 250),
			{ initialProps: { value: "stay" } },
		)
		rerender({ value: "should-not-arrive" })
		unmount()
		act(() => {
			vi.advanceTimersByTime(1000)
		})
		expect(result.current).toBe("stay")
	})
})
