import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useConfirmDialog } from "./useConfirmDialog"

describe("useConfirmDialog", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("opens with a fresh target and typed input", () => {
		const { result } = renderHook(() => useConfirmDialog<{ name: string }>())

		act(() => result.current.setTyped("old"))
		act(() => result.current.open({ name: "foo" }))

		expect(result.current.isOpen).toBe(true)
		expect(result.current.target).toEqual({ name: "foo" })
		expect(result.current.typed).toBe("")
	})

	it("closes immediately but keeps target/typed until the exit animation finishes", () => {
		const { result } = renderHook(() => useConfirmDialog<{ name: string }>())

		act(() => result.current.open({ name: "foo" }))
		act(() => result.current.setTyped("bar"))
		act(() => result.current.close())

		expect(result.current.isOpen).toBe(false)
		expect(result.current.target).toEqual({ name: "foo" })
		expect(result.current.typed).toBe("bar")

		act(() => vi.advanceTimersByTime(150))

		expect(result.current.target).toBeUndefined()
		expect(result.current.typed).toBe("")
	})

	it("cancels a pending clear when the dialog is reopened", () => {
		const { result } = renderHook(() => useConfirmDialog<{ name: string }>())

		act(() => result.current.open({ name: "foo" }))
		act(() => result.current.close())
		act(() => vi.advanceTimersByTime(50))
		act(() => result.current.open({ name: "bar" }))

		expect(result.current.isOpen).toBe(true)
		expect(result.current.target).toEqual({ name: "bar" })

		act(() => vi.advanceTimersByTime(200))

		expect(result.current.target).toEqual({ name: "bar" })
	})

	it("clears via onOpenChange(false) the same way as close()", () => {
		const { result } = renderHook(() => useConfirmDialog<{ name: string }>())

		act(() => result.current.open({ name: "foo" }))
		act(() => result.current.onOpenChange(false))

		expect(result.current.isOpen).toBe(false)
		expect(result.current.target).toEqual({ name: "foo" })

		act(() => vi.advanceTimersByTime(150))

		expect(result.current.target).toBeUndefined()
	})
})
