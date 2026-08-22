/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { visibleNeighbors } from "./ResSearchPreviewDialog"

function row(
	id: string,
	pluginId: string | null = `p-${id}`,
	previewPluginId: string | undefined = undefined,
) {
	return { id, contentPluginId: pluginId, previewPluginId }
}

const ROWS = [row("a"), row("b"), row("c"), row("d"), row("e")]

function ids(result: readonly { resId: string }[]): string[] {
	return result.map((n) => n.resId)
}

describe("visibleNeighbors", () => {
	it("is symmetric ±1 with no direction yet", () => {
		expect(ids(visibleNeighbors(ROWS, 2, undefined))).toEqual(["b", "d"])
	})

	it("extends one slot forward after a next flip", () => {
		expect(ids(visibleNeighbors(ROWS, 2, "next"))).toEqual(["b", "d", "e"])
	})

	it("extends one slot backward after a prev flip", () => {
		expect(ids(visibleNeighbors(ROWS, 2, "prev"))).toEqual(["a", "b", "d"])
	})

	it("clips out-of-range indexes at both ends", () => {
		expect(ids(visibleNeighbors(ROWS, 0, "prev"))).toEqual(["b"])
		expect(ids(visibleNeighbors(ROWS, 4, "next"))).toEqual(["d"])
		expect(ids(visibleNeighbors(ROWS, 0, "next"))).toEqual(["b", "c"])
	})

	it("is empty for a negative index (not found in rows)", () => {
		expect(visibleNeighbors(ROWS, -1, "next")).toEqual([])
	})

	it("skips rows without a content plugin", () => {
		const rows = [row("a"), row("b", null), row("c")]
		expect(ids(visibleNeighbors(rows, 1, "next"))).toEqual(["a", "c"])
	})

	it("prefers previewPluginId over the stored plugin id", () => {
		const rows = [
			row("a", "p-missing-a", "p-builtin"),
			row("b", "p-missing-b", "p-builtin"),
			row("c"),
		]
		const result = visibleNeighbors(rows, 1, undefined)
		expect(ids(result)).toEqual(["a", "c"])
		// The neighbor with a missing stored plugin previews via its
		// resolved fallback id; a healthy one keeps its own id.
		expect(result[0]?.pluginId).toBe("p-builtin")
		expect(result[1]?.pluginId).toBe("p-c")
	})
})
