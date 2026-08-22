import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { type ReactNode, useMemo } from "react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createQueryClient } from "@/trpc/client"
import { usePref } from "./usePref"

const trpcQuery = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null))
const trpcMutate = vi.fn((..._args: unknown[]) =>
	Promise.resolve<unknown>(undefined),
)

vi.mock("@/trpc/factory", () => ({
	trpcQuery: (...args: unknown[]) => trpcQuery(...args),
	trpcMutate: (...args: unknown[]) => trpcMutate(...args),
}))

describe("usePref", () => {
	function Wrapper({ children }: { readonly children: ReactNode }) {
		const client = useMemo(() => createQueryClient(), [])
		return <QueryClientProvider client={client}>{children}</QueryClientProvider>
	}

	beforeEach(() => {
		trpcQuery.mockReset()
		trpcMutate.mockReset()
		trpcQuery.mockResolvedValue(null)
		trpcMutate.mockResolvedValue(undefined)
	})

	afterEach(() => {
		// Flush any in-flight scheduler writes so state does not leak between tests.
		window.dispatchEvent(new Event("pagehide"))
		vi.clearAllMocks()
	})

	test("falls back to default value when the server has no entry", async () => {
		const { result } = renderHook(() => usePref("test.missing", "default"), {
			wrapper: Wrapper,
		})

		await waitFor(() => expect(result.current[0]).toBe("default"))
		expect(trpcQuery).toHaveBeenCalledWith("asyncPreference", "get", {
			key: "test.missing",
		})
		expect(trpcMutate).not.toHaveBeenCalled()
	})

	test("decodes the server value with the default JSON codec", async () => {
		trpcQuery.mockResolvedValueOnce({ value: '["a","b"]', updatedAt: 1 })

		const { result } = renderHook(
			() => usePref("test.list", [] as readonly string[]),
			{ wrapper: Wrapper },
		)

		await waitFor(() => expect(result.current[0]).toEqual(["a", "b"]))
	})

	test("set updates the cached value immediately and flushes to server after debounce", async () => {
		trpcQuery.mockResolvedValueOnce({ value: "1", updatedAt: 1 })

		const { result } = renderHook(() => usePref("test.counter", 0), {
			wrapper: Wrapper,
		})

		await waitFor(() => expect(result.current[0]).toBe(1))

		act(() => {
			result.current[1](5)
		})

		await waitFor(() => {
			expect(result.current[0]).toBe(5)
			expect(trpcMutate).not.toHaveBeenCalled()
		})

		await vi.waitFor(() => expect(trpcMutate).toHaveBeenCalledTimes(1), {
			timeout: 1_000,
		})
		expect(trpcMutate).toHaveBeenLastCalledWith("asyncPreference", "set", {
			key: "test.counter",
			value: "5",
		})
	})

	test("rapid sets collapse into a single server write", async () => {
		trpcQuery.mockResolvedValueOnce({ value: "0", updatedAt: 1 })

		const { result } = renderHook(() => usePref("test.rapid", 0), {
			wrapper: Wrapper,
		})

		await waitFor(() => expect(result.current[0]).toBe(0))

		act(() => {
			result.current[1](1)
			result.current[1](2)
			result.current[1](3)
		})

		await waitFor(() => expect(result.current[0]).toBe(3))
		await vi.waitFor(() => expect(trpcMutate).toHaveBeenCalledTimes(1), {
			timeout: 1_000,
		})
		expect(trpcMutate).toHaveBeenLastCalledWith("asyncPreference", "set", {
			key: "test.rapid",
			value: "3",
		})
	})

	test("pagehide flushes pending writes immediately", async () => {
		trpcQuery.mockResolvedValueOnce({ value: "0", updatedAt: 1 })

		const { result } = renderHook(() => usePref("test.pagehide", 0), {
			wrapper: Wrapper,
		})

		await waitFor(() => expect(result.current[0]).toBe(0))

		act(() => {
			result.current[1](9)
		})
		expect(trpcMutate).not.toHaveBeenCalled()

		window.dispatchEvent(new Event("pagehide"))

		expect(trpcMutate).toHaveBeenCalledTimes(1)
		expect(trpcMutate).toHaveBeenLastCalledWith("asyncPreference", "set", {
			key: "test.pagehide",
			value: "9",
		})
	})
})
