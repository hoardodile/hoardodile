/**
 * @vitest-environment node
 */

import { LOCAL_TIME_ZONE_SENTINEL } from "@hoardodile/schemas/timezone"
import { describe, expect, test } from "vitest"
import { resolveTimeZone } from "./timezone.ts"

describe("resolveTimeZone", () => {
	test("passes through IANA zones", () => {
		expect(resolveTimeZone("Asia/Shanghai")).toBe("Asia/Shanghai")
		expect(resolveTimeZone("UTC")).toBe("UTC")
	})

	test("resolves local sentinel with provided local zone", () => {
		expect(resolveTimeZone(LOCAL_TIME_ZONE_SENTINEL, "Asia/Shanghai")).toBe(
			"Asia/Shanghai",
		)
	})

	test("resolves empty string like local", () => {
		expect(resolveTimeZone("", "Europe/London")).toBe("Europe/London")
	})

	test("falls back to UTC when local zone is unknown", () => {
		expect(resolveTimeZone(LOCAL_TIME_ZONE_SENTINEL)).toBe("UTC")
		expect(resolveTimeZone("")).toBe("UTC")
	})
})
