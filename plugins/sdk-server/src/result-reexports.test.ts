import type { Result } from "@hoardodile/sdk-types"
import { describe, expect, test } from "vitest"
import {
	err,
	isDetected,
	isErr,
	isMissed,
	isOk,
	matchResult,
	ok,
} from "./index.ts"

describe("result helper re-exports", () => {
	test("ok/err build the same literal shapes as the contract", () => {
		expect(ok()).toEqual({ ok: true })
		expect(ok({ files: [] })).toEqual({ ok: true, files: [] })
		expect(err({ reasons: ["required-file"] })).toEqual({
			ok: false,
			reasons: ["required-file"],
		})
	})

	test("guards narrow both branches", () => {
		const hit = ok({ page: 1 })
		const miss = err({ reasons: ["page-image"] })
		expect(isOk(hit)).toBe(true)
		expect(isOk(miss)).toBe(false)
		expect(isErr(miss)).toBe(true)
		expect(isErr(hit)).toBe(false)
		expect(isDetected(hit)).toBe(true)
		expect(isMissed(miss)).toBe(true)
	})

	test("matchResult dispatches to the branch handler", () => {
		type Hit = { readonly count: number }
		type Miss = { readonly reasons: readonly string[] }
		const hit: Result<Hit, Miss> = ok({ count: 2 })
		const miss: Result<Hit, Miss> = err({ reasons: ["required-file"] })
		expect(
			matchResult(hit, {
				ok: (r) => r.count,
				err: () => 0,
			}),
		).toBe(2)
		expect(
			matchResult(miss, {
				ok: () => 0,
				err: (r) => r.reasons.length,
			}),
		).toBe(1)
	})
})
