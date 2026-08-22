import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useFilterDraft } from "./useFilterDraft"

type Filters = {
	query: string
	tagIds: readonly string[]
	random: boolean
}

const KEYS = ["query", "tagIds", "random"] as const

const DEFAULTS: Filters = { query: "", tagIds: [], random: false }

function setup(applied: Filters) {
	const applyDraft = vi.fn()
	const utils = renderHook(
		({ current }: { current: Filters }) =>
			useFilterDraft(current, KEYS, DEFAULTS, applyDraft),
		{ initialProps: { current: applied } },
	)
	return { applyDraft, ...utils }
}

describe("useFilterDraft", () => {
	it("starts from the applied filter keys", () => {
		const { result } = setup({ query: "harbor", tagIds: ["a"], random: false })
		expect(result.current.draft).toEqual({
			query: "harbor",
			tagIds: ["a"],
			random: false,
		})
		expect(result.current.hasChanges).toBe(false)
	})

	it("stages edits without applying them", () => {
		const { applyDraft, result } = setup(DEFAULTS)
		act(() => result.current.change({ random: true }))
		expect(result.current.draft.random).toBe(true)
		expect(result.current.hasChanges).toBe(true)
		expect(applyDraft).not.toHaveBeenCalled()
	})

	it("applies the whole draft through the writer", () => {
		const { applyDraft, result } = setup(DEFAULTS)
		act(() => result.current.change({ query: "harbor", tagIds: ["a"] }))
		act(() => result.current.apply())
		expect(applyDraft).toHaveBeenCalledWith({
			query: "harbor",
			tagIds: ["a"],
			random: false,
		})
	})

	it("re-syncs from the applied state once applied (no pending edits)", () => {
		const { applyDraft, result, rerender } = setup(DEFAULTS)
		act(() => result.current.change({ random: true }))
		act(() => result.current.apply())
		// The caller's writer changes the applied state to match the draft.
		rerender({ current: { query: "", tagIds: [], random: true } })
		expect(result.current.draft).toEqual({
			query: "",
			tagIds: [],
			random: true,
		})
		expect(result.current.hasChanges).toBe(false)
		expect(applyDraft).toHaveBeenCalledTimes(1)
	})

	it("keeps staged edits when the applied state changes externally", () => {
		const { result, rerender } = setup(DEFAULTS)
		act(() => result.current.change({ tagIds: ["a"] }))
		rerender({ current: { query: "other", tagIds: [], random: false } })
		expect(result.current.draft).toEqual({
			query: "",
			tagIds: ["a"],
			random: false,
		})
		expect(result.current.hasChanges).toBe(true)
	})

	it("resets the draft when the applied state changes without pending edits", () => {
		const { result, rerender } = setup({
			query: "harbor",
			tagIds: [],
			random: false,
		})
		rerender({ current: { query: "", tagIds: [], random: true } })
		expect(result.current.draft).toEqual({
			query: "",
			tagIds: [],
			random: true,
		})
		expect(result.current.hasChanges).toBe(false)
	})

	it("clears by applying the defaults", () => {
		const { applyDraft, result } = setup({
			query: "harbor",
			tagIds: ["a"],
			random: true,
		})
		act(() => result.current.clear())
		expect(applyDraft).toHaveBeenCalledWith(DEFAULTS)
	})
})
