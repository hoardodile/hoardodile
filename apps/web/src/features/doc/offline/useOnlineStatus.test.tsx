import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
	markNetworkOffline,
	markNetworkOnline,
	useOnlineStatus,
} from "./useOnlineStatus.ts"

describe("useOnlineStatus", () => {
	beforeEach(() => {
		window.dispatchEvent(new Event("online"))
		markNetworkOnline()
	})

	afterEach(() => {
		window.dispatchEvent(new Event("online"))
		markNetworkOnline()
	})

	test("starts online when the browser reports online", () => {
		const { result } = renderHook(() => useOnlineStatus())
		expect(result.current).toBe(true)
	})

	test("flips to offline on the browser offline event", () => {
		const { result } = renderHook(() => useOnlineStatus())
		act(() => {
			window.dispatchEvent(new Event("offline"))
		})
		expect(result.current).toBe(false)
		act(() => {
			window.dispatchEvent(new Event("online"))
		})
		expect(result.current).toBe(true)
	})

	test("a network failure marks offline even while the browser is online", () => {
		const { result } = renderHook(() => useOnlineStatus())
		act(() => {
			markNetworkOffline()
		})
		expect(result.current).toBe(false)
	})

	test("a successful save clears the failure-based offline flag", () => {
		const { result } = renderHook(() => useOnlineStatus())
		act(() => {
			markNetworkOffline()
		})
		expect(result.current).toBe(false)
		act(() => {
			markNetworkOnline()
		})
		expect(result.current).toBe(true)
	})

	test("the browser online event also clears the failure-based flag", () => {
		const { result } = renderHook(() => useOnlineStatus())
		act(() => {
			markNetworkOffline()
		})
		act(() => {
			window.dispatchEvent(new Event("online"))
		})
		expect(result.current).toBe(true)
	})
})
