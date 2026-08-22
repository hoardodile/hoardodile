import {
	conflict,
	DomainError,
	forbidden,
	invalid,
	notFound,
	unauthorized,
} from "@hoardodile/shared"
import { TRPCError } from "@trpc/server"
import { describe, expect, test } from "vitest"
import { toTRPCError } from "./errors.ts"

describe("toTRPCError", () => {
	test("passes through an existing TRPCError unchanged", () => {
		const original = new TRPCError({ code: "UNAUTHORIZED", message: "nope" })
		expect(toTRPCError(original)).toBe(original)
	})

	test.each([
		[notFound("resource.not_found", "missing"), "NOT_FOUND"],
		[conflict("resource.already_trashed", "already trashed"), "CONFLICT"],
		[invalid("resource.name_empty", "empty name"), "BAD_REQUEST"],
		[forbidden("mirror.read_only", "mirror read-only"), "FORBIDDEN"],
		[unauthorized("auth.required", "login needed"), "UNAUTHORIZED"],
		[
			new DomainError("RATE_LIMITED", "quota", "slow down"),
			"TOO_MANY_REQUESTS",
		],
	])("maps %s to %s", (err, expectedCode) => {
		const mapped = toTRPCError(err)
		expect(mapped).toBeInstanceOf(TRPCError)
		expect(mapped.code).toBe(expectedCode)
		expect(mapped.cause).toBe(err)
		expect(mapped.message).toBe(err.message)
	})

	test("collapses unknown throws to INTERNAL_SERVER_ERROR with a generic message", () => {
		const mapped = toTRPCError(new Error("disk path /var/x"))
		expect(mapped.code).toBe("INTERNAL_SERVER_ERROR")
		expect(mapped.message).toBe("internal error")
	})

	test("handles non-Error throws safely", () => {
		const mapped = toTRPCError("boom")
		expect(mapped.code).toBe("INTERNAL_SERVER_ERROR")
		expect(mapped.message).toBe("internal error")
		expect(mapped.cause).toBeUndefined()
	})
})
