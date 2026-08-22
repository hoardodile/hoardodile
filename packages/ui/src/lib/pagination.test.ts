/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { pageCountOf, paginationWindow } from "./pagination"

describe("pageCountOf", () => {
	it("returns 1 when there are no rows so the UI never shows '1 / 0'", () => {
		expect(pageCountOf(0, 20)).toBe(1)
	})

	it("returns 1 when total fits exactly in one page", () => {
		expect(pageCountOf(20, 20)).toBe(1)
	})

	it("rounds up to cover the partial trailing page", () => {
		expect(pageCountOf(21, 20)).toBe(2)
		expect(pageCountOf(99, 10)).toBe(10)
	})

	it("returns 1 for negative or NaN input rather than 0 or NaN", () => {
		expect(pageCountOf(-5, 20)).toBe(1)
	})
})

describe("paginationWindow", () => {
	it("shows first, last, the asymmetric window and ellipses for a middle page", () => {
		expect(paginationWindow(6, 68)).toEqual([1, "…", 5, 6, 7, 8, "…", 68])
	})

	it("renders every page when the range fits without gaps", () => {
		expect(paginationWindow(3, 5)).toEqual([1, 2, 3, 4, 5])
		expect(paginationWindow(3, 6)).toEqual([1, 2, 3, 4, 5, 6])
		expect(paginationWindow(4, 7)).toEqual([1, "…", 3, 4, 5, 6, 7])
		expect(paginationWindow(4, 8)).toEqual([1, "…", 3, 4, 5, 6, "…", 8])
	})

	it("drops the leading ellipse when the window touches the first page", () => {
		expect(paginationWindow(1, 68)).toEqual([1, 2, 3, "…", 68])
		expect(paginationWindow(3, 68)).toEqual([1, 2, 3, 4, 5, "…", 68])
	})

	it("drops the trailing ellipse when the window touches the last page", () => {
		expect(paginationWindow(68, 68)).toEqual([1, "…", 67, 68])
		expect(paginationWindow(67, 68)).toEqual([1, "…", 66, 67, 68])
		expect(paginationWindow(66, 68)).toEqual([1, "…", 65, 66, 67, 68])
	})

	it("stays within bounds for tiny ranges", () => {
		expect(paginationWindow(1, 1)).toEqual([1])
		expect(paginationWindow(1, 2)).toEqual([1, 2])
		expect(paginationWindow(2, 3)).toEqual([1, 2, 3])
	})
})
