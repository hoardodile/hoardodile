// @vitest-environment node
import { describe, expect, test } from "vitest"
import type { FileListEntry } from "./FileListEditor"
import { batchCreateOrder } from "./useBatchResourceSubmit"

function entry(id: string): FileListEntry {
	return { id, file: new File(["x"], `${id}.txt`) }
}

describe("batchCreateOrder", () => {
	test("creates in reverse display order so the newest-first grid renders the drag order", () => {
		const entries = [entry("a"), entry("b"), entry("c")]
		expect(batchCreateOrder(entries).map((e) => e.id)).toEqual(["c", "b", "a"])
	})

	test("preserves the input array", () => {
		const entries = [entry("a"), entry("b")]
		batchCreateOrder(entries)
		expect(entries.map((e) => e.id)).toEqual(["a", "b"])
	})

	test("empty input stays empty", () => {
		expect(batchCreateOrder([])).toEqual([])
	})
})
