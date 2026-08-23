import { createResourceAPIFixture } from "@hoardodile/sdk-server"
import { describe, expect, test } from "vitest"
import plugin from "../main"
import type { PdfSchema } from "../shared"

const enc = (s: string) => new TextEncoder().encode(s)

/**
 * A tiny well-formed-enough PDF body: header + a catalog/pages tree that
 * the counting regex must not mistake for page objects + two pages.
 */
const TWO_PAGES = enc(
	"%PDF-1.4\n" +
		"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
		"2 0 obj\n<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] >>\nendobj\n" +
		"3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n" +
		"5 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n" +
		"%%EOF\n",
)

describe("detect", () => {
	test("claims a resource containing a real PDF", async () => {
		const { api } = createResourceAPIFixture<PdfSchema>({
			files: ["two-pages.pdf"],
			contents: { "two-pages.pdf": TWO_PAGES },
		})
		await expect(plugin.detect(api)).resolves.toEqual({ ok: true })
	})

	test("misses a resource with no PDF at all", async () => {
		const { api } = createResourceAPIFixture<PdfSchema>({
			files: ["notes.txt"],
			contents: { "notes.txt": "hello" },
		})
		const result = await plugin.detect(api)
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reasons.join(" ")).toContain("no .pdf")
	})

	test("rejects a renamed non-PDF even with a .pdf extension", async () => {
		const { api } = createResourceAPIFixture<PdfSchema>({
			files: ["fake.pdf"],
			contents: { "fake.pdf": "This is not a PDF." },
		})
		const result = await plugin.detect(api)
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reasons.join(" ")).toContain("%PDF")
	})

	test("claims a mixed resource when at least one PDF is real", async () => {
		const { api } = createResourceAPIFixture<PdfSchema>({
			files: ["fake.pdf", "two-pages.pdf"],
			contents: {
				"fake.pdf": "This is not a PDF.",
				"two-pages.pdf": TWO_PAGES,
			},
		})
		await expect(plugin.detect(api)).resolves.toEqual({ ok: true })
	})

	test("misses a resource whose only PDF is empty", async () => {
		const { api } = createResourceAPIFixture<PdfSchema>({
			files: ["empty.pdf"],
			contents: { "empty.pdf": "" },
		})
		const result = await plugin.detect(api)
		expect(result.ok).toBe(false)
	})
})

describe("sourceMeta", () => {
	test("lists PDF files, sizes and a best-effort page count", async () => {
		const { api } = createResourceAPIFixture<PdfSchema>({
			files: ["two-pages.pdf", "cover.jpg"],
			contents: { "two-pages.pdf": TWO_PAGES },
			stats: { "two-pages.pdf": { sizeBytes: 4096 } },
		})
		const meta = await plugin.sourceMeta!(api)
		expect(meta).toEqual({
			files: ["two-pages.pdf"],
			pageCount: 2,
			sizeBytes: 4096,
			version: "1.4",
		})
	})

	test("skips the page scan for large files", async () => {
		// Contents intentionally absent — a full read would throw; the
		// size guard must prevent it.
		const { api } = createResourceAPIFixture<PdfSchema>({
			files: ["big.pdf", "big2.pdf"],
			stats: {
				"big.pdf": { sizeBytes: 10 * 1024 * 1024 },
				"big2.pdf": { sizeBytes: 9 * 1024 * 1024 },
			},
		})
		const meta = await plugin.sourceMeta!(api)
		expect(meta?.pageCount).toBeUndefined()
		expect(meta?.version).toBeUndefined()
		expect(meta?.sizeBytes).toBe(19 * 1024 * 1024)
		expect(meta?.files).toEqual(["big.pdf", "big2.pdf"])
	})
})

describe("listFiles", () => {
	test("returns typed entries with sizes, PDFs only", async () => {
		const { api } = createResourceAPIFixture<PdfSchema>({
			files: ["a.pdf", "b.pdf", "readme.md"],
			stats: { "a.pdf": { sizeBytes: 10 }, "b.pdf": { sizeBytes: 20 } },
		})
		await expect(plugin.listFiles!(api)).resolves.toEqual([
			{ filename: "a.pdf", sizeBytes: 10 },
			{ filename: "b.pdf", sizeBytes: 20 },
		])
	})
})
