import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useDeferredMount } from "./useDeferredMount"

describe("useDeferredMount", () => {
	it("mounts only after an animation frame", async () => {
		const { result } = renderHook(() => useDeferredMount("doc-a"))
		expect(result.current).toBe(false)
		await waitFor(() => expect(result.current).toBe(true))
	})

	it("re-defers when the reset key changes", async () => {
		const { result, rerender } = renderHook(({ id }) => useDeferredMount(id), {
			initialProps: { id: "doc-a" },
		})
		await waitFor(() => expect(result.current).toBe(true))
		rerender({ id: "doc-b" })
		expect(result.current).toBe(false)
		await waitFor(() => expect(result.current).toBe(true))
	})
})
