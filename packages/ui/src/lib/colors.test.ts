/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import {
	computeTagChipColors,
	isBlackHex,
	isSpecialTagStyle,
	isWhiteHex,
	TAG_SPECIAL_STYLES,
} from "./colors"

describe("isWhiteHex", () => {
	it("matches common white representations", () => {
		expect(isWhiteHex("#fff")).toBe(true)
		expect(isWhiteHex("#FFFFFF")).toBe(true)
		expect(isWhiteHex("white")).toBe(true)
		expect(isWhiteHex("rgb(255,255,255)")).toBe(true)
		expect(isWhiteHex("rgba( 255 , 255 , 255 , 0.5)")).toBe(true)
	})

	it("rejects empty and non-white colors", () => {
		expect(isWhiteHex("")).toBe(false)
		expect(isWhiteHex("#000")).toBe(false)
		expect(isWhiteHex("#abcdef")).toBe(false)
		expect(isWhiteHex("rgb(254,255,255)")).toBe(false)
	})
})

describe("isBlackHex", () => {
	it("matches common black representations", () => {
		expect(isBlackHex("#000")).toBe(true)
		expect(isBlackHex("#000000")).toBe(true)
		expect(isBlackHex("BLACK")).toBe(true)
		expect(isBlackHex("rgb(0, 0, 0)")).toBe(true)
	})

	it("rejects empty and non-black colors", () => {
		expect(isBlackHex("")).toBe(false)
		expect(isBlackHex("#fff")).toBe(false)
		expect(isBlackHex("rgb(0,0,1)")).toBe(false)
	})
})

describe("computeTagChipColors", () => {
	it("falls back to muted/accent vars for empty color", () => {
		const colors = computeTagChipColors("")
		expect(colors.baseBg).toContain("var(--color-muted)")
		expect(colors.hoverBg).toContain("var(--color-accent)")
		expect(colors.fg).toContain("var(--color-foreground)")
	})

	it("returns explicit white treatment for white", () => {
		const colors = computeTagChipColors("#ffffff")
		expect(colors.baseBg).toBe("#ffffff")
		expect(colors.fg).toBe("#0a0a0a")
	})

	it("returns explicit black treatment for black", () => {
		const colors = computeTagChipColors("black")
		expect(colors.baseBg).toBe("#0a0a0a")
		expect(colors.fg).toBe("#ffffff")
	})

	it("uses color-mix blends for arbitrary colors", () => {
		const colors = computeTagChipColors("#3366ff")
		expect(colors.baseBg).toContain("color-mix")
		expect(colors.baseBg).toContain("6%")
		expect(colors.hoverBg).toContain("20%")
		expect(colors.fg).toBe("#3366ff")
	})

	it("treats special style names as ordinary colors", () => {
		const colors = computeTagChipColors("rainbow")
		expect(colors.baseBg).toContain("color-mix")
		expect(colors.fg).toBe("rainbow")
	})
})

describe("isSpecialTagStyle", () => {
	it("matches all known special styles", () => {
		for (const style of TAG_SPECIAL_STYLES) {
			expect(isSpecialTagStyle(style)).toBe(true)
		}
	})

	it("rejects regular colors and empty", () => {
		expect(isSpecialTagStyle("")).toBe(false)
		expect(isSpecialTagStyle("#ff0000")).toBe(false)
		expect(isSpecialTagStyle("red")).toBe(false)
		expect(isSpecialTagStyle("rainbowish")).toBe(false)
	})
})
