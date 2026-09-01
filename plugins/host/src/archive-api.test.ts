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
import { createPluginResourceAPI } from "./api.ts"
import { resolveSevenZipPath } from "./archive/7z.ts"
import type { ResourceContainer } from "./container.ts"

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

function makeSevenZip(
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

/**
 * The plugin-facing container contract under the unified addressing model:
 * an entry is addressed as `outer!inner` and read straight from the
 * central directory (zip) or from the extraction cache (non-zip) after
 * `extractArchive`. Both formats answer the same plugin API.
 */
describe("plugin container addressing (outer!inner)", () => {
	let cacheDir: string

	afterEach(() => {
		rmSync(cacheDir, { recursive: true, force: true })
	})

	function apiOf(containerName: string, archiveBytes: Buffer) {
		cacheDir = mkdtempSync(join(tmpdir(), "archive-api-"))
		return createPluginResourceAPI({
			view: memoryContainer({ [containerName]: archiveBytes }),
			extractCacheDir: cacheDir,
			cacheScope: "test",
		})
	}

	it("reads and lists a zip entry from the central directory", async () => {
		const zip = makeZip([
			{
				name: "Ch1/001.jpg",
				data: Uint8Array.from([1, 2, 3, 4, 5]),
				method: 8,
			},
			{ name: "Ch1/002.jpg", data: Uint8Array.from([11, 12, 13]) },
		])
		const api = apiOf("book.cbz", zip)

		// The cheap listing never materializes.
		expect(
			(await api.listContainer("book.cbz")).entries.map((e) => e.path),
		).toEqual(["Ch1/001.jpg", "Ch1/002.jpg"])
		// The virtual entry reads straight from the central directory.
		expect([...(await api.readFile("book.cbz!Ch1/001.jpg"))]).toEqual([
			1, 2, 3, 4, 5,
		])
		expect(await api.statFile("book.cbz!Ch1/002.jpg")).toEqual({
			sizeBytes: 3,
		})

		// A missing inner entry surfaces as a stat miss / read error.
		expect(await api.statFile("book.cbz!nope.jpg")).toBeUndefined()
		await expect(api.readFile("book.cbz!nope.jpg")).rejects.toThrow()
	})

	it.skipIf(!sevenZipAvailable)(
		"extracts and reads a non-zip entry from the extraction cache",
		async () => {
			const archive = makeSevenZip(
				mkdtempSync(join(tmpdir(), "archive-api-")),
				{
					"Ch1/001.jpg": "first",
					"Ch1/002.jpg": "second",
				},
			)
			const api = apiOf("book.cb7", archive)

			// The cheap listing never materializes.
			expect(
				(await api.listContainer("book.cb7")).entries.map((e) => e.path),
			).toEqual(["Ch1/001.jpg", "Ch1/002.jpg"])

			// Before materialization a non-zip inner is not readable — and
			// this absent read must NOT poison the view for a later
			// extract+read (the manifest memo only keeps positive results).
			await expect(api.readFile("book.cb7!Ch1/001.jpg")).rejects.toThrow()

			const extraction = await api.extractArchive("book.cb7")
			expect(extraction.entries.map((e) => e.path)).toEqual([
				"Ch1/001.jpg",
				"Ch1/002.jpg",
			])

			// After materialization the SAME outer!inner form reads from disk,
			// even though the same view instance saw it absent a moment ago.
			expect(
				Buffer.from(await api.readFile("book.cb7!Ch1/001.jpg")).toString(),
			).toBe("first")
			expect(await api.statFile("book.cb7!Ch1/002.jpg")).toEqual({
				sizeBytes: 6,
			})
		},
	)
})
