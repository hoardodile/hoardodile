/**
 * @vitest-environment node
 */

import type { UsageTotal } from "@hoardodile/schemas"
import { describe, expect, it } from "vitest"
import { mergeRecentViewedTotals } from "./mergeRecentViewedTotals"

function stubTotal(
	input: Partial<UsageTotal> & Pick<UsageTotal, "entityType" | "entityId">,
): UsageTotal {
	return {
		id: `${input.entityType}:${input.entityId}`,
		granularity: "all",
		period: null,
		totalMs: 0,
		viewCount: 1,
		lastViewedAt: 100,
		updatedAt: 100,
		...input,
	}
}

describe("mergeRecentViewedTotals", () => {
	it("merges groups and sorts by lastViewedAt descending", () => {
		const merged = mergeRecentViewedTotals([
			[
				stubTotal({
					entityType: "resource",
					entityId: "res-old",
					lastViewedAt: 100,
				}),
			],
			[
				stubTotal({
					entityType: "character",
					entityId: "char-new",
					lastViewedAt: 300,
				}),
			],
			[
				stubTotal({
					entityType: "document",
					entityId: "doc-mid",
					lastViewedAt: 200,
				}),
			],
		])

		expect(merged.map((row) => row.entityId)).toEqual([
			"char-new",
			"doc-mid",
			"res-old",
		])
	})

	it("dedupes by entity type and id keeping the most recent row", () => {
		const merged = mergeRecentViewedTotals([
			[
				stubTotal({
					entityType: "resource",
					entityId: "res-1",
					lastViewedAt: 100,
				}),
				stubTotal({
					entityType: "resource",
					entityId: "res-1",
					lastViewedAt: 500,
				}),
			],
		])

		expect(merged).toHaveLength(1)
		expect(merged[0]?.lastViewedAt).toBe(500)
	})

	it("places null lastViewedAt rows last", () => {
		const merged = mergeRecentViewedTotals([
			[
				stubTotal({
					entityType: "resource",
					entityId: "res-null",
					lastViewedAt: null,
					updatedAt: 999,
				}),
				stubTotal({
					entityType: "character",
					entityId: "char-recent",
					lastViewedAt: 200,
				}),
			],
		])

		expect(merged.map((row) => row.entityId)).toEqual([
			"char-recent",
			"res-null",
		])
	})

	it("excludes plugin rows", () => {
		const merged = mergeRecentViewedTotals([
			[
				stubTotal({
					entityType: "plugin",
					entityId: "plugin-1",
					lastViewedAt: 999,
				}),
				stubTotal({
					entityType: "document",
					entityId: "doc-1",
					lastViewedAt: 100,
				}),
			],
		])

		expect(merged).toHaveLength(1)
		expect(merged[0]?.entityType).toBe("document")
	})
})
