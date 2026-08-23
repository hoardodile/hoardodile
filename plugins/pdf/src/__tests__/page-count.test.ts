import { describe, expect, test } from "vitest"
import { countPagesFromBytes, pdfVersionFromBytes } from "../page-count"

const enc = (s: string) => new TextEncoder().encode(s)

describe("countPagesFromBytes", () => {
	test("counts visible /Type /Page objects and ignores the Pages tree", () => {
		const pdf = enc(
			"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
				"2 0 obj\n<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] >>\nendobj\n" +
				"3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n" +
				"5 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n" +
				"trailer\n%%EOF\n",
		)
		expect(countPagesFromBytes(pdf)).toBe(2)
	})

	test("matches without whitespace between /Type and /Page", () => {
		const pdf = enc("%PDF-1.4\n<< /Type/Page /MediaBox [0 0 612 792] >>\n")
		expect(countPagesFromBytes(pdf)).toBe(1)
	})

	test("returns undefined for nothing matching", () => {
		const pdf = enc("%PDF-1.4\n<< /Type /Pages /Count 9 >>\n")
		expect(countPagesFromBytes(pdf)).toBeUndefined()
	})

	test("returns undefined for non-PDF bytes", () => {
		expect(countPagesFromBytes(enc("plain text"))).toBeUndefined()
	})
})

describe("pdfVersionFromBytes", () => {
	test("extracts the header version", () => {
		expect(pdfVersionFromBytes(enc("%PDF-1.7\n…"))).toBe("1.7")
	})

	test("returns undefined without a header", () => {
		expect(pdfVersionFromBytes(enc("hello"))).toBeUndefined()
	})
})
