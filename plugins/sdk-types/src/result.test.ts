import { describe, expect, test } from "vitest"
import { type Detection, err, isErr, isOk, matchResult, ok } from "./index.ts"

describe("ok / err", () => {
	test("ok() yields the bare success marker", () => {
		expect(ok()).toEqual({ ok: true })
	})

	test("err() yields the bare failure marker", () => {
		expect(err()).toEqual({ ok: false })
	})

	test("payloads spread onto the marker", () => {
		expect(ok({ start: 0, end: 9 })).toEqual({ ok: true, start: 0, end: 9 })
		expect(err({ code: "bad", message: "no" })).toEqual({
			ok: false,
			code: "bad",
			message: "no",
		})
	})

	test("the plugin-facing literal stays assignable to the shared types", () => {
		const detected: Detection = { ok: true } as const
		expect(detected).toEqual({ ok: true })
	})
})

describe("guards", () => {
	test("isOk narrows the success payload", () => {
		const result = ok({ start: 4, end: 10 })
		expect(isOk(result)).toBe(true)
		if (isOk(result)) {
			expect(result.start).toBe(4)
		}
	})

	test("isErr narrows the failure payload", () => {
		const result = err({ code: "bad" })
		expect(isErr(result)).toBe(true)
		if (isErr(result)) {
			expect(result.code).toBe("bad")
		}
	})
})

describe("matchResult", () => {
	test("dispatches to the matching handler with its payload", () => {
		const message = (r: { readonly ok: boolean }) =>
			matchResult(r, {
				ok: (p) => `ok ${p.ok}`,
				err: (p) => `err ${p.ok}`,
			})
		expect(message(ok())).toBe("ok true")
		expect(message(err())).toBe("err false")
	})

	test("handlers can produce a common value", () => {
		const value = matchResult(ok({ start: 1 }), {
			ok: (p) => p.start,
			err: () => 0,
		})
		expect(value).toBe(1)
	})
})
