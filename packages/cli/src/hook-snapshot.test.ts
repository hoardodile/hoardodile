import { describe, expect, test } from "vitest"
import { snapshotDetect } from "./hook-snapshot.ts"

describe("snapshotDetect", () => {
	test("strips the payload from a successful match", () => {
		const detection = { ok: true, kind: "archive", filename: "book.cbz" }
		expect(snapshotDetect(detection)).toEqual({ ok: true })
	})

	test("keeps the miss reasons", () => {
		expect(snapshotDetect({ ok: false, reasons: ["page-image"] })).toEqual({
			ok: false,
			reasons: ["page-image"],
		})
	})

	test("normalizes a reasons-less miss", () => {
		expect(snapshotDetect({ ok: false })).toEqual({
			ok: false,
			reasons: undefined,
		})
	})
})
