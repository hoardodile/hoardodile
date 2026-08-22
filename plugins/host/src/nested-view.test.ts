// @vitest-environment node

import { execFileSync } from "node:child_process"
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Readable } from "node:stream"
import { afterEach, describe, expect, it } from "vitest"
import { makeZip } from "./__testutils__/zip-fixtures.ts"
import { resolveSevenZipPath } from "./archive/7z.ts"
import { createArchiveExtractor } from "./archive/extract-archive.ts"
import type { ResourceContainer } from "./container.ts"
import { createNestedAwareContainer } from "./nested-view.ts"

const sevenZipAvailable = resolveSevenZipPath() !== undefined

function memoryContainer(
	files: Readonly<Record<string, Buffer>>,
): ResourceContainer {
	return {
		listEntries: async () => Object.keys(files).sort(),
		readEntry: async (rel) => {
			const buf = files[rel]
			if (buf === undefined) throw new Error(`no entry ${rel}`)
			return buf
		},
		readEntrySlice: async (rel, start, end) => {
			const buf = files[rel]
			if (buf === undefined) throw new Error(`no entry ${rel}`)
			return buf.subarray(start, Math.min(end, buf.length))
		},
		openEntryStream: async (rel) => {
			const buf = files[rel]
			if (buf === undefined) throw new Error(`no entry ${rel}`)
			return { stream: Readable.from([buf]), size: buf.length }
		},
		resolveByteRange: async (rel) => {
			const buf = files[rel]
			return buf === undefined ? undefined : { size: buf.length }
		},
	}
}

const DEFLATED = makeZip([
	{
		name: "Ch1/001.jpg",
		data: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
		method: 8,
	},
	{ name: "Ch1/002.jpg", data: Uint8Array.from([11, 12, 13]) },
])

describe("createNestedAwareContainer", () => {
	const container = createNestedAwareContainer(
		memoryContainer({
			"book.cbz": DEFLATED,
			"plain.txt": Buffer.from("hello world"),
		}),
	)

	it("passes literal entries through unchanged", async () => {
		expect(await container.resolveByteRange("plain.txt")).toEqual({ size: 11 })
		expect(await container.readEntrySlice("plain.txt", 0, 5)).toEqual(
			Buffer.from("hello"),
		)
	})

	it("resolves virtual path sizes", async () => {
		expect(await container.resolveByteRange("book.cbz!Ch1/002.jpg")).toEqual({
			size: 3,
		})
		expect(
			await container.resolveByteRange("book.cbz!missing.jpg"),
		).toBeUndefined()
	})

	it("streams virtual entries with their decompressed size", async () => {
		const { stream, size } = await container.openEntryStream(
			"book.cbz!Ch1/001.jpg",
		)
		const chunks: Buffer[] = []
		for await (const chunk of stream) chunks.push(Buffer.from(chunk))
		expect(size).toBe(10)
		expect(Buffer.concat(chunks)).toEqual(
			Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
		)
	})

	it("slices virtual entries without inflating the whole entry", async () => {
		const head = await container.readEntrySlice("book.cbz!Ch1/001.jpg", 0, 4)
		expect(head).toEqual(Buffer.from([1, 2, 3, 4]))
	})

	it("clamps out-of-range slices", async () => {
		const tail = await container.readEntrySlice("book.cbz!Ch1/001.jpg", 8, 100)
		expect(tail).toEqual(Buffer.from([9, 10]))
	})

	it("keeps listEntries flat", async () => {
		expect(await container.listEntries()).toEqual(["book.cbz", "plain.txt"])
	})
})

// â”€â”€ Materialized addressing (extracted non-zip containers) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeSevenZipArchive(
	dir: string,
	files: Readonly<Record<string, string>>,
): Buffer {
	const payload = join(dir, "payload")
	mkdirSync(payload, { recursive: true })
	for (const [name, content] of Object.entries(files)) {
		const filePath = join(payload, name)
		mkdirSync(dirname(filePath), { recursive: true })
		writeFileSync(filePath, content)
	}
	const archivePath = join(dir, "book.cb7")
	execFileSync(resolveSevenZipPath()!, ["a", "-t7z", archivePath, "."], {
		cwd: payload,
		stdio: "ignore",
	})
	return readFileSync(archivePath)
}

describe.skipIf(!sevenZipAvailable)(
	"createNestedAwareContainer materialized addressing",
	() => {
		let root: string
		let cacheDir: string

		afterEach(() => {
			rmSync(root, { recursive: true, force: true })
		})

		function extractorFor(base: ResourceContainer) {
			return createArchiveExtractor({
				outer: {
					sizeOf: (rel) => base.resolveByteRange(rel).then((r) => r?.size),
					readSlice: (rel, start, end) => base.readEntrySlice(rel, start, end),
				},
				cacheDir,
				maxBytes: 1024 * 1024,
				maxEntries: 100,
			})
		}

		it("serves extracted entries from disk with seekable paths", async () => {
			root = mkdtempSync(join(tmpdir(), "nested-view-"))
			cacheDir = join(root, "cache")
			const archive = makeSevenZipArchive(root, {
				"Ch1/001.jpg": "first",
				"Ch1/002.jpg": "second",
			})
			const base = memoryContainer({ "book.cb7": archive })
			await extractorFor(base).extract("book.cb7")

			const view = createNestedAwareContainer(
				base,
				undefined,
				undefined,
				cacheDir,
			)
			expect(await view.resolveByteRange("book.cb7!Ch1/001.jpg")).toEqual({
				size: 5,
			})
			const { stream, size, path } = await view.openEntryStream(
				"book.cb7!Ch1/002.jpg",
			)
			const chunks: Buffer[] = []
			for await (const chunk of stream) chunks.push(Buffer.from(chunk))
			expect(size).toBe(6)
			expect(Buffer.concat(chunks).toString("utf8")).toBe("second")
			expect(path).toBe(join(cacheDir, "book.cb7", "Ch1", "002.jpg"))
			expect(await view.readEntrySlice("book.cb7!Ch1/001.jpg", 0, 3)).toEqual(
				Buffer.from("fir"),
			)
			expect(await view.resolveSeekablePath?.("book.cb7!Ch1/001.jpg")).toBe(
				join(cacheDir, "book.cb7", "Ch1", "001.jpg"),
			)
		})

		it("does not address non-extracted containers", async () => {
			root = mkdtempSync(join(tmpdir(), "nested-view-"))
			cacheDir = join(root, "cache")
			const archive = makeSevenZipArchive(root, { "a.txt": "x" })
			const base = memoryContainer({ "book.cb7": archive })
			const view = createNestedAwareContainer(
				base,
				undefined,
				undefined,
				cacheDir,
			)
			expect(await view.resolveByteRange("book.cb7!a.txt")).toBeUndefined()
			expect(await view.resolveSeekablePath?.("book.cb7!a.txt")).toBeUndefined()
		})

		it("ignores paths outside the manifest whitelist", async () => {
			root = mkdtempSync(join(tmpdir(), "nested-view-"))
			cacheDir = join(root, "cache")
			const archive = makeSevenZipArchive(root, { "a.txt": "x" })
			const base = memoryContainer({ "book.cb7": archive })
			await extractorFor(base).extract("book.cb7")
			const view = createNestedAwareContainer(
				base,
				undefined,
				undefined,
				cacheDir,
			)
			expect(
				await view.resolveByteRange("book.cb7!missing.txt"),
			).toBeUndefined()
			expect(
				await view.resolveByteRange("book.cb7!../escape.txt"),
			).toBeUndefined()
		})
	},
)
