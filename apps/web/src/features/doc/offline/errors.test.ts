/**
 * @vitest-environment node
 */

import { TRPCClientError } from "@trpc/client"
import { describe, expect, test } from "vitest"
import { isNetworkError } from "./errors.ts"

function trpcErrorWithData(data: unknown): TRPCClientError<never> {
	return TRPCClientError.from({
		error: { code: 409, message: "conflict", data },
	})
}

describe("isNetworkError", () => {
	test("is false for tRPC errors carrying a server payload", () => {
		const err = trpcErrorWithData({
			code: "CONFLICT",
			domain: { kind: "x" },
		})
		expect(isNetworkError(err)).toBe(false)
	})

	test("is true for tRPC transport errors without data", () => {
		expect(
			isNetworkError(TRPCClientError.from(new Error("fetch failed"))),
		).toBe(true)
		expect(isNetworkError(new Error("boom"))).toBe(true)
		expect(isNetworkError("not an error")).toBe(true)
	})
})
