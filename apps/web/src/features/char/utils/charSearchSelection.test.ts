/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from "vitest"
import {
	resolveCardSelection,
	toggleSelectionMembership,
} from "./charSearchSelection"

describe("toggleSelectionMembership", () => {
	it("adds an id when not already selected", () => {
		const onChange = vi.fn()
		toggleSelectionMembership({ mode: "multi", selected: ["a"], onChange }, "b")
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange.mock.calls[0]?.[0]).toEqual(["a", "b"])
	})

	it("removes an id when already selected", () => {
		const onChange = vi.fn()
		toggleSelectionMembership(
			{ mode: "multi", selected: ["a", "b"], onChange },
			"a",
		)
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange.mock.calls[0]?.[0]).toEqual(["b"])
	})
})

describe("resolveCardSelection", () => {
	it("returns undefined when no selection is configured (browse mode)", () => {
		expect(resolveCardSelection(undefined, "x")).toBeUndefined()
	})

	it("marks single-mode card as selected only when its id matches", () => {
		const onChange = vi.fn()
		const matched = resolveCardSelection(
			{ mode: "single", selected: "x", onChange },
			"x",
		)
		const other = resolveCardSelection(
			{ mode: "single", selected: "x", onChange },
			"y",
		)
		expect(matched?.selected).toBe(true)
		expect(other?.selected).toBe(false)
	})

	it("delegates onToggle for single mode to onChange with the card id", () => {
		const onChange = vi.fn()
		const state = resolveCardSelection(
			{ mode: "single", selected: undefined, onChange },
			"y",
		)
		state?.onToggle()
		expect(onChange).toHaveBeenCalledWith("y")
	})

	it("delegates onToggle for multi mode through toggleSelectionMembership", () => {
		const onChange = vi.fn()
		const state = resolveCardSelection(
			{ mode: "multi", selected: ["a"], onChange },
			"b",
		)
		state?.onToggle()
		expect(onChange).toHaveBeenCalledWith(["a", "b"])
	})
})
