import { describe, expect, test } from "vitest"
import { escapeLike } from "./like.ts"

describe("escapeLike", () => {
	test("escapes the `%` wildcard", () => {
		expect(escapeLike("100%")).toBe("100\\%")
	})

	test("escapes the `_` wildcard", () => {
		expect(escapeLike("a_b")).toBe("a\\_b")
	})

	test("escapes the backslash escape character itself", () => {
		expect(escapeLike("a\\b")).toBe("a\\\\b")
	})

	test("escapes all three classes in the same string", () => {
		expect(escapeLike("\\_%")).toBe("\\\\\\_\\%")
	})

	test("leaves ordinary text unchanged", () => {
		expect(escapeLike("hello world")).toBe("hello world")
	})

	test("is a no-op on the empty string", () => {
		expect(escapeLike("")).toBe("")
	})
})
