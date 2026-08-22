import { describe, expect, test } from "vitest"
import { assessPasswordStrength } from "./strength.ts"

describe("assessPasswordStrength", () => {
	test("flags short passwords", () => {
		expect(assessPasswordStrength("abc")).toBe("weak")
		expect(assessPasswordStrength("hunter2")).toBe("weak")
		expect(assessPasswordStrength("abcdefg")).toBe("weak")
	})

	test("flags all-digit passwords regardless of length", () => {
		expect(assessPasswordStrength("12345678")).toBe("weak")
		expect(assessPasswordStrength("123456789012")).toBe("weak")
	})

	test("accepts non-trivial long passwords", () => {
		expect(assessPasswordStrength("correct-horse-battery")).toBe("ok")
		expect(assessPasswordStrength("hunter2x")).toBe("ok")
		expect(assessPasswordStrength("1234567a")).toBe("ok")
	})
})
