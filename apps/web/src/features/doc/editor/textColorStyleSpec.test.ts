/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { resolveTextColor } from "./textColorStyleSpec"

describe("resolveTextColor", () => {
	it("returns undefined for the default / empty value", () => {
		expect(resolveTextColor("default")).toBeUndefined()
		expect(resolveTextColor("")).toBeUndefined()
	})

	it("maps BlockNote's named palette colors to their text color", () => {
		expect(resolveTextColor("red")).toBe("#e03e3e")
		expect(resolveTextColor("blue")).toBe("#0b6e99")
	})

	it("passes hex and css color values through unchanged", () => {
		expect(resolveTextColor("#27ae60")).toBe("#27ae60")
		expect(resolveTextColor("rgb(255, 0, 0)")).toBe("rgb(255, 0, 0)")
		expect(resolveTextColor("crimson")).toBe("crimson")
	})

	it("maps palette css names to the palette value", () => {
		expect(resolveTextColor("orange")).toBe("#d9730d")
	})
})
