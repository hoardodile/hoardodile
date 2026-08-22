// @vitest-environment node

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { makeTar, makeZip } from "../__testutils__/zip-fixtures.ts"
import { resolveSevenZipPath } from "./7z.ts"
import {
	createArchiveExtractor,
	EXTRACT_INDEX_VERSION,
	sanitizeExtractPath,
} from "./extract-archive.ts"
import type { OuterEntrySource } from "./nested-entry.ts"

// Materialization now runs whole-archive through 7-Zip, so the extractor
// behavior tests need the binary; the pure helpers stay unguarded.
const sevenZipAvailable = resolveSevenZipPath() !== undefined

// ── Fixture outer ────────────────────────────────────────────────────────────

function outerFrom(files: Readonly<Record<string, Buffer>>): OuterEntrySource {
	return {
		sizeOf: async (rel) => {
			const buf = files[rel]
			return buf === undefined ? undefined : buf.length
		},
		readSlice: async (rel, start, end) => {
			const buf = files[rel]
			if (buf === undefined) throw new Error(`missing fixture entry ${rel}`)
			return buf.subarray(start, Math.min(end, buf.length))
		},
	}
}

const FIXED_PROBE = {
	width: 800,
	height: 1200,
	animated: false,
}

describe.skipIf(!sevenZipAvailable)("createArchiveExtractor", () => {
	let cacheDir: string

	beforeEach(() => {
		cacheDir = mkdtempSync(join(tmpdir(), "hoard-extract-"))
	})

	afterEach(() => {
		rmSync(cacheDir, { recursive: true, force: true })
	})

	const bookCbz = makeZip([
		{ name: "Ch1/001.jpg", data: Uint8Array.from([1, 2, 3]) },
		{ name: "Ch1/002.jpg", data: Uint8Array.from([4, 5]) },
		{ name: "Ch2/001.jpg", data: Uint8Array.from([6]) },
	])
	const deflated = makeZip([
		{
			name: "page.png",
			data: Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9, 9, 9]),
			method: 8,
		},
	])
	const bookTar = makeTar([
		{ name: "Ch1/001.jpg", data: Uint8Array.from([7, 7]) },
		{ name: "Ch1/002.jpg", data: Uint8Array.from([8, 8, 8]) },
	])

	function extractor(
		files: Readonly<Record<string, Buffer>>,
		overrides: Partial<Parameters<typeof createArchiveExtractor>[0]> = {},
	) {
		return createArchiveExtractor({
			outer: outerFrom(files),
			cacheDir,
			maxBytes: 1024 * 1024,
			maxEntries: 100,
			probeImage: async () => FIXED_PROBE,
			...overrides,
		})
	}

	it("materializes zip entries preserving subdirectories, with dims", async () => {
		const result = await extractor({ "book.cbz": bookCbz }).extract("book.cbz")
		expect(result.entries.map((e) => e.path)).toEqual([
			"Ch1/001.jpg",
			"Ch1/002.jpg",
			"Ch2/001.jpg",
		])
		expect(result.entries[0]).toMatchObject({
			sizeBytes: 3,
			kind: "image",
			width: 800,
			height: 1200,
		})
		expect(readFileSync(join(cacheDir, "book.cbz", "Ch1", "002.jpg"))).toEqual(
			Buffer.from([4, 5]),
		)
		expect(existsSync(join(cacheDir, "book.cbz", "index.json"))).toBe(true)
	})

	it("inflates deflate entries", async () => {
		const result = await extractor({ "d.zip": deflated }).extract("d.zip")
		expect(result.entries).toHaveLength(1)
		expect(readFileSync(join(cacheDir, "d.zip", "page.png"))).toEqual(
			Buffer.from([9, 9, 9, 9, 9, 9, 9, 9, 9, 9]),
		)
	})

	it("materializes tar entries", async () => {
		const result = await extractor({ "t.tar": bookTar }).extract("t.tar")
		expect(result.entries.map((e) => e.path)).toEqual([
			"Ch1/001.jpg",
			"Ch1/002.jpg",
		])
		expect(readFileSync(join(cacheDir, "t.tar", "Ch1", "002.jpg"))).toEqual(
			Buffer.from([8, 8, 8]),
		)
	})

	it("re-lists from the manifest without re-extracting (idempotent)", async () => {
		const ex = extractor({ "book.cbz": bookCbz })
		const first = await ex.extract("book.cbz")
		const second = await ex.extract("book.cbz")
		expect(second.entries).toEqual(first.entries)
	})

	it("completes a partial extraction on retry", async () => {
		// Simulate a crash mid-extraction: files written but no manifest.
		const boom = join(cacheDir, "book.cbz")
		await import("node:fs/promises")
			.then(({ mkdir, writeFile }) =>
				writeFile(join(boom, "Ch1", "001.jpg"), Buffer.from([1, 2, 3]), {
					flag: "w",
				}).catch(() =>
					mkdir(join(boom, "Ch1"), { recursive: true }).then(() =>
						writeFile(join(boom, "Ch1", "001.jpg"), Buffer.from([1, 2, 3])),
					),
				),
			)
			.catch(() => {})
		const result = await extractor({ "book.cbz": bookCbz }).extract("book.cbz")
		expect(result.entries).toHaveLength(3)
		expect(existsSync(join(cacheDir, "book.cbz", "index.json"))).toBe(true)
	})

	it("honours the byte and entry budgets", async () => {
		await expect(
			extractor({ "book.cbz": bookCbz }, { maxBytes: 5 }).extract("book.cbz"),
		).rejects.toThrow(/exceeding the limit/)
		await expect(
			extractor({ "book.cbz": bookCbz }, { maxEntries: 2 }).extract("book.cbz"),
		).rejects.toThrow(/exceeding the limit/)
	})

	it("rejects non-container entries with a clear error", async () => {
		const files = { "note.txt": Buffer.from("hello") }
		await expect(extractor(files).extract("note.txt")).rejects.toThrow(
			/not a supported archive/,
		)
	})

	it("rejects extraction of a traversal-planted archive", async () => {
		const evil = makeZip([
			{ name: "Ch1/001.jpg", data: Uint8Array.from([1]) },
			{ name: "../escape.jpg", data: Uint8Array.from([2]) },
		])
		await expect(
			extractor({ "evil.cbz": evil }).extract("evil.cbz"),
		).rejects.toThrow(/unsafe path/)
	})

	it("single-flights concurrent extraction", async () => {
		const ex = extractor({ "book.cbz": bookCbz })
		const [a, b] = await Promise.all([
			ex.extract("book.cbz"),
			ex.extract("book.cbz"),
		])
		expect(b.entries).toEqual(a.entries)
		const manifest = JSON.parse(
			readFileSync(join(cacheDir, "book.cbz", "index.json"), "utf8"),
		) as { readonly v: number }
		expect(manifest.v).toBe(EXTRACT_INDEX_VERSION)
	})

	it("reports progress once after whole-archive extraction", async () => {
		const steps: { readonly done: number; readonly total: number }[] = []
		const result = await extractor(
			{ "book.cbz": bookCbz },
			{ onProgress: (p) => steps.push(p) },
		).extract("book.cbz")
		expect(result.entries).toHaveLength(3)
		// The 7-Zip path materializes in one pass; progress is a single
		// completion report instead of per-entry ticks.
		expect(steps).toEqual([{ done: 3, total: 3 }])
		// A second (cached) call reports nothing — no materialization.
		steps.length = 0
		await extractor(
			{ "book.cbz": bookCbz },
			{ onProgress: (p) => steps.push(p) },
		).extract("book.cbz")
		expect(steps).toEqual([])
	})
})

describe("sanitizeExtractPath", () => {
	it("rejects unsafe inner paths (traversal)", () => {
		expect(() => sanitizeExtractPath("../evil.jpg")).toThrow(/unsafe path/)
		expect(() => sanitizeExtractPath("a/../../evil.jpg")).toThrow(/unsafe path/)
		expect(() => sanitizeExtractPath("/abs/evil.jpg")).toThrow(/absolute path/)
		expect(sanitizeExtractPath("a\\b.jpg")).toBe("a/b.jpg")
		expect(sanitizeExtractPath("ok/name.jpg")).toBe("ok/name.jpg")
	})
})
