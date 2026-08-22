import { describe, expect, test } from "vitest"
import {
	conflict,
	DomainError,
	forbidden,
	invalid,
	isDomainError,
	notFound,
	unauthorized,
} from "./errors.ts"

describe("DomainError", () => {
	test("carries code, kind, message, and optional details", () => {
		const e = new DomainError(
			"NOT_FOUND",
			"resource.not_found",
			"No such resource",
			{ id: "res_1" },
		)
		expect(e.code).toBe("NOT_FOUND")
		expect(e.kind).toBe("resource.not_found")
		expect(e.message).toBe("No such resource")
		expect(e.details).toEqual({ id: "res_1" })
	})

	test("toPayload omits details when absent", () => {
		const e = new DomainError(
			"VALIDATION",
			"resource.name_empty",
			"Name is required",
		)
		expect(e.toPayload()).toEqual({
			kind: "resource.name_empty",
			message: "Name is required",
		})
	})

	test("isDomainError narrows instances", () => {
		const e: unknown = notFound("x", "y")
		expect(isDomainError(e)).toBe(true)
		expect(isDomainError(new Error("x"))).toBe(false)
	})

	test("factories produce the expected code", () => {
		expect(notFound("a", "a").code).toBe("NOT_FOUND")
		expect(conflict("a", "a").code).toBe("CONFLICT")
		expect(invalid("a", "a").code).toBe("VALIDATION")
		expect(forbidden("a", "a").code).toBe("FORBIDDEN")
		expect(unauthorized("a", "a").code).toBe("UNAUTHORIZED")
	})
})
