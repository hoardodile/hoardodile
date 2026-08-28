/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { masonryNextPageParam } from "./index"

function page(total: number, page: number, size: number) {
	return { rows: [], total, page, size }
}

describe("masonryNextPageParam", () => {
	it("advances while the current page does not cover the total", () => {
		expect(masonryNextPageParam(page(50, 2, 20))).toBe(3)
		expect(masonryNextPageParam(page(61, 1, 20))).toBe(2)
	})

	it("stops exactly at a full last page", () => {
		expect(masonryNextPageParam(page(40, 2, 20))).toBeUndefined()
	})

	it("stops on a partial last page", () => {
		expect(masonryNextPageParam(page(41, 3, 20))).toBeUndefined()
	})

	it("stops when the first page is already the only one", () => {
		expect(masonryNextPageParam(page(15, 1, 20))).toBeUndefined()
	})

	it("stops when there is nothing to page through", () => {
		expect(masonryNextPageParam(page(0, 1, 20))).toBeUndefined()
	})
})
