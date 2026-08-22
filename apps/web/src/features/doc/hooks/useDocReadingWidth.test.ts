import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
	DOC_READING_WIDTH_DEFAULT,
	normalizeReadingWidth,
	useDocReadingWidth,
} from "./useDocPrefs"

describe("normalizeReadingWidth", () => {
	it("keeps the two valid width slots", () => {
		expect(normalizeReadingWidth(680)).toBe(680)
		expect(normalizeReadingWidth(800)).toBe(800)
	})

	it("snaps any other value to the default", () => {
		expect(normalizeReadingWidth(0)).toBe(DOC_READING_WIDTH_DEFAULT)
		expect(normalizeReadingWidth(700)).toBe(DOC_READING_WIDTH_DEFAULT)
		expect(normalizeReadingWidth(Number.NaN)).toBe(DOC_READING_WIDTH_DEFAULT)
	})
})

describe("useDocReadingWidth", () => {
	it("defaults to 680", () => {
		const { result } = renderHook(() => useDocReadingWidth())
		expect(result.current.readingWidth).toBe(680)
	})

	it("persists a switch to 800", () => {
		const { result } = renderHook(() => useDocReadingWidth())

		act(() => result.current.setReadingWidth(800))
		expect(result.current.readingWidth).toBe(800)

		const again = renderHook(() => useDocReadingWidth())
		expect(again.result.current.readingWidth).toBe(800)
	})

	it("rejects values outside the width slots", () => {
		const { result } = renderHook(() => useDocReadingWidth())

		act(() => result.current.setReadingWidth(1024))
		expect(result.current.readingWidth).toBe(680)
	})
})
