import { describe, expect, test } from "vitest"
import { isValidIanaTimeZone } from "./timezone.ts"

describe("isValidIanaTimeZone", () => {
	test("accepts known IANA zones", () => {
		expect(isValidIanaTimeZone("UTC")).toBe(true)
		expect(isValidIanaTimeZone("Asia/Shanghai")).toBe(true)
	})

	test("rejects invalid zone names", () => {
		expect(isValidIanaTimeZone("Foo/Bar")).toBe(false)
		expect(isValidIanaTimeZone("local")).toBe(false)
	})
})
