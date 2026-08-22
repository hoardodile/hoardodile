import { describe, expect, it } from "vitest"
import { decodeLegacyZipName } from "./name-decode.ts"

describe("decodeLegacyZipName", () => {
	it("passes ASCII through unchanged", () => {
		expect(decodeLegacyZipName(Buffer.from("a/b.txt"))).toBe("a/b.txt")
		expect(decodeLegacyZipName(Buffer.from(""))).toBe("")
	})

	it("keeps valid UTF-8 names untouched", () => {
		const utf8E = Buffer.from("café.jpg", "utf8")
		expect(decodeLegacyZipName(utf8E)).toBe("café.jpg")
	})

	it("decodes legacy bytes as cp437 instead of losing them", () => {
		// 0x82 is é in cp437 but an invalid standalone UTF-8 byte.
		const legacy = Buffer.from("caf\x82.jpg", "latin1")
		expect(decodeLegacyZipName(legacy)).toBe("caf\u00e9.jpg")
	})

	it("maps a spread of high bytes through the cp437 table", () => {
		// 0xe9 -> Θ, 0xff -> nbsp, 0xa4 -> ñ
		expect(decodeLegacyZipName(Buffer.from([0xe9]))).toBe("\u0398")
		expect(decodeLegacyZipName(Buffer.from([0xff]))).toBe("\u00a0")
		expect(decodeLegacyZipName(Buffer.from([0xa4]))).toBe("\u00f1")
	})

	it("decodes every byte losslessly (no U+FFFD replacement)", () => {
		for (let byte = 0x80; byte <= 0xff; byte++) {
			const decoded = decodeLegacyZipName(Buffer.from([byte]))
			expect(decoded).not.toBe("\ufffd")
		}
	})
})
