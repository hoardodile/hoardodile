/**
 * @vitest-environment node
 */

import type { ResCard } from "@hoardodile/schemas"
import { describe, expect, it } from "vitest"
import { stubResCard } from "@/test/stubs/cards"
import {
	distributeMasonry,
	estimateCardHeight,
	MASONRY_CARD_CHROME_PX,
	MASONRY_COLUMN_GAP_PX,
	MASONRY_COLUMN_PX,
	masonryColumnCount,
} from "./masonry"

function card(id: string, overrides?: Partial<ResCard>): ResCard {
	return stubResCard(id, `Resource ${id}`, overrides)
}

function flat(columns: ResCard[][]): string[] {
	return columns.flatMap((col) => col.map((c) => c.id))
}

describe("masonryColumnCount", () => {
	it("is at least one column", () => {
		expect(masonryColumnCount(0)).toBe(1)
		expect(masonryColumnCount(279)).toBe(1)
	})

	it("adds one column per full 280px slot", () => {
		expect(masonryColumnCount(280)).toBe(1)
		expect(masonryColumnCount(560)).toBe(2)
		expect(masonryColumnCount(840)).toBe(3)
	})

	it("floors partial slots", () => {
		expect(masonryColumnCount(300)).toBe(1)
		expect(masonryColumnCount(839)).toBe(2)
	})
})

describe("estimateCardHeight", () => {
	it("derives the thumb height from the cover aspect ratio", () => {
		// 800x600 at 280px wide → 210px thumb.
		const h = estimateCardHeight(
			card("a", {
				coverMeta: { kind: "image", width: 800, height: 600 },
			}),
		)
		expect(h).toBe(210 + MASONRY_CARD_CHROME_PX + MASONRY_COLUMN_GAP_PX)
	})

	it("falls back to a square tile when there is no cover", () => {
		expect(estimateCardHeight(card("b"))).toBe(
			MASONRY_COLUMN_PX + MASONRY_CARD_CHROME_PX + MASONRY_COLUMN_GAP_PX,
		)
	})
})

describe("distributeMasonry", () => {
	it("keeps every row in exactly one column and preserves order", () => {
		const rows = [
			card("a"),
			card("b"),
			card("c"),
			card("d"),
			card("e"),
			card("f"),
		]
		const columns = distributeMasonry(rows, 3)
		expect(flat(columns).sort()).toEqual(["a", "b", "c", "d", "e", "f"])
		// Within a column, rows keep their relative order.
		for (const col of columns) {
			for (let i = 1; i < col.length; i += 1) {
				expect(rows.indexOf(col[i]!)).toBeGreaterThan(rows.indexOf(col[i - 1]!))
			}
		}
	})

	it("is prefix-stable: appending a row never reassigns an existing row", () => {
		const base = [card("a"), card("b"), card("c"), card("d"), card("e")]
		const before = distributeMasonry(base, 2)
		const beforeAssignment = new Map<string, number>()
		before.forEach((col, i) => {
			for (const r of col) beforeAssignment.set(r.id, i)
		})

		const after = distributeMasonry([...base, card("f")], 2)
		const afterAssignment = new Map<string, number>()
		after.forEach((col, i) => {
			for (const r of col) afterAssignment.set(r.id, i)
		})

		for (const [id, col] of beforeAssignment) {
			expect(afterAssignment.get(id)).toBe(col)
		}
		// The appended row lands in some column and the whole set is present.
		expect(new Set(flat(after))).toEqual(
			new Set([...base.map((c) => c.id), "f"]),
		)
		expect(flat(after)).toContain("f")
	})

	it("balances columns by estimated height", () => {
		// One very tall card plus five short ones; the short ones fill other
		// columns rather than stacking behind the tall card.
		const tall = card("tall", {
			coverMeta: { kind: "image", width: 100, height: 800 },
		})
		const short = (id: string) =>
			card(id, { coverMeta: { kind: "image", width: 800, height: 100 } })
		const rows = [
			tall,
			short("b"),
			short("c"),
			short("d"),
			short("e"),
			short("f"),
		]
		const columns = distributeMasonry(rows, 2)
		// The tall card must not share a column with every short card.
		const tallColumn = columns.findIndex((col) =>
			col.some((r) => r.id === "tall"),
		)
		const otherCount = (columns[tallColumn === 0 ? 1 : 0] ?? []).length
		expect(otherCount).toBeGreaterThan(0)
	})

	it("is deterministic", () => {
		const rows = [card("a"), card("b"), card("c"), card("d"), card("e")]
		expect(distributeMasonry(rows, 3)).toEqual(distributeMasonry(rows, 3))
	})
})
