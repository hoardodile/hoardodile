import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buffer } from "node:stream/consumers"
import { createNestedCdCache } from "@hoardodile/host"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { describe, expect, test } from "vitest"
import yazl from "yazl"
import { buildSourceArtifactView } from "./source-view.ts"

const PAYLOAD = Buffer.alloc(64 * 1024, 0xab)

async function writeEntry(
	root: string,
	name: string,
	bytes: Buffer,
): Promise<void> {
	const dest = join(root, name)
	await mkdir(join(dest, ".."), { recursive: true })
	await writeFileSync(dest, bytes)
}

function buildDirSpec(
	paths: ReturnType<typeof createStoragePaths>,
	resId: string,
): { kind: "dir"; dirPath: string } {
	return { kind: "dir", dirPath: paths.latest.resource(resId) }
}

describe("openEntryStream", () => {
	test("streams bare-file entry bytes without writing extracted cache", async () => {
		const root = mkdtempSync(join(tmpdir(), "src-view-stream-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			const resId = "res-stream"
			await mkdir(paths.latest.resource(resId), { recursive: true })
			const payload = Buffer.from("stream-bytes")
			await writeEntry(paths.latest.resource(resId), "clip.mp4", payload)

			const view = buildSourceArtifactView(
				{ paths },
				resId,
				1,
				buildDirSpec(paths, resId),
			)

			const { stream, size } = await view.openEntryStream("clip.mp4")
			expect(size).toBe(payload.length)
			const read = await buffer(stream)
			expect(read.equals(payload)).toBe(true)

			const extractedDir = join(
				root,
				"local",
				"cache",
				"resources",
				resId,
				"extracted",
			)
			await expect(stat(extractedDir)).rejects.toThrow()
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("readEntrySlice", () => {
	test("reads a positioned byte range from a bare file", async () => {
		const root = mkdtempSync(join(tmpdir(), "src-view-slice-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			const resId = "res-slice"
			await mkdir(paths.latest.resource(resId), { recursive: true })
			const payload = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
			await writeEntry(paths.latest.resource(resId), "data.bin", payload)
			await writeEntry(
				paths.latest.resource(resId),
				"empty.bin",
				Buffer.alloc(0),
			)

			const view = buildSourceArtifactView(
				{ paths },
				resId,
				1,
				buildDirSpec(paths, resId),
			)

			expect(
				(await view.readEntrySlice("data.bin", 2, 5)).toJSON().data,
			).toEqual([3, 4, 5])
			// End clamps to the file size; past-the-end start is empty.
			expect(
				(await view.readEntrySlice("data.bin", 6, 100)).toJSON().data,
			).toEqual([7, 8])
			expect((await view.readEntrySlice("data.bin", 100, 200)).byteLength).toBe(
				0,
			)
			// Zero-length file does not read past bounds.
			expect((await view.readEntrySlice("empty.bin", 0, 10)).byteLength).toBe(0)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("withMaterializedEntry literal path passthrough", () => {
	test("hands the real file path over with no copy", async () => {
		const root = mkdtempSync(join(tmpdir(), "src-view-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			const resId = "res-cache"
			await mkdir(paths.latest.resource(resId), { recursive: true })
			await writeEntry(
				paths.latest.resource(resId),
				"clip.mp4",
				Buffer.from("video-bytes"),
			)

			const view = buildSourceArtifactView(
				{ paths },
				resId,
				1,
				buildDirSpec(paths, resId),
			)

			const first = await view.withMaterializedEntry(
				"clip.mp4",
				async (path) => path,
			)
			const second = await view.withMaterializedEntry(
				"clip.mp4",
				async (path) => path,
			)
			expect(first).toBe(second)
			expect(first).toBe(join(paths.latest.resource(resId), "clip.mp4"))
			const cached = await readFile(first, "utf8")
			expect(cached).toBe("video-bytes")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("withMaterializedEntry virtual extraction", () => {
	test("parallel views share one extraction of a nested entry", async () => {
		const root = mkdtempSync(join(tmpdir(), "src-view-race-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			const resId = "res-race"
			await mkdir(paths.latest.resource(resId), { recursive: true })
			// A deflated cbz as a bare top-level file.
			const inner = new yazl.ZipFile()
			inner.addBuffer(PAYLOAD, "Ch1/001.jpg")
			inner.end()
			const cbzChunks: Buffer[] = []
			for await (const chunk of inner.outputStream) {
				cbzChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
			}
			await writeEntry(
				paths.latest.resource(resId),
				"book.cbz",
				Buffer.concat(cbzChunks),
			)

			const deps = { paths }
			const viewA = buildSourceArtifactView(
				deps,
				resId,
				1,
				buildDirSpec(paths, resId),
			)
			const viewB = buildSourceArtifactView(
				deps,
				resId,
				1,
				buildDirSpec(paths, resId),
			)

			const [pathA, pathB] = await Promise.all([
				viewA.withMaterializedEntry(
					"book.cbz!Ch1/001.jpg",
					async (path) => path,
				),
				viewB.withMaterializedEntry(
					"book.cbz!Ch1/001.jpg",
					async (path) => path,
				),
			])

			expect(pathA).toBe(pathB)
			const cached = await readFile(pathA)
			expect(cached.equals(PAYLOAD)).toBe(true)
			const info = await stat(pathA)
			expect(info.size).toBe(PAYLOAD.length)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("resolveByteRange", () => {
	test("stats the file per call and misses after removal", async () => {
		const root = mkdtempSync(join(tmpdir(), "src-view-stat-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			const resId = "res-stat"
			await mkdir(paths.latest.resource(resId), { recursive: true })
			await writeEntry(paths.latest.resource(resId), "a.jpg", Buffer.from("x"))
			const deps = { paths }

			const view = buildSourceArtifactView(
				deps,
				resId,
				1,
				buildDirSpec(paths, resId),
			)
			await expect(view.resolveByteRange("a.jpg")).resolves.toEqual({
				size: 1,
			})
			await rm(join(paths.latest.resource(resId), "a.jpg"))
			await expect(view.resolveByteRange("a.jpg")).resolves.toBeUndefined()
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("nested cache scoping", () => {
	test("openEntryStream exposes the backing path for literal entries only", async () => {
		const root = mkdtempSync(join(tmpdir(), "src-view-path-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			const resId = "res-path"
			const dir = paths.latest.resource(resId)
			await mkdir(dir, { recursive: true })
			const zip = new yazl.ZipFile()
			zip.addBuffer(Buffer.from("page"), "p.txt")
			zip.end()
			const chunks: Buffer[] = []
			for await (const chunk of zip.outputStream) {
				chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
			}
			await writeFile(join(dir, "a.txt"), Buffer.from("x"))
			await writeFile(join(dir, "book.cbz"), Buffer.concat(chunks))

			const view = buildSourceArtifactView(
				{ paths },
				resId,
				1,
				buildDirSpec(paths, resId),
			)

			const literal = await view.openEntryStream("a.txt")
			expect(literal.path).toBe(join(dir, "a.txt"))
			// Virtual entries have no byte window — no path, decompressed stream.
			const virtual = await view.openEntryStream("book.cbz!p.txt")
			expect(virtual.path).toBeUndefined()
			expect(virtual.size).toBe(4)
			// Consume the lazy stream so no read outlives the teardown.
			await buffer(virtual.stream)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("same-named archives in different resources never share listings", async () => {
		const root = mkdtempSync(join(tmpdir(), "src-view-scope-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			const sharedNested = createNestedCdCache()
			async function buildCbz(
				entries: readonly (readonly [string, number[]])[],
			) {
				const zip = new yazl.ZipFile()
				for (const [name, bytes] of entries) {
					zip.addBuffer(Buffer.from(bytes), name)
				}
				zip.end()
				const chunks: Buffer[] = []
				for await (const chunk of zip.outputStream) {
					chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
				}
				return Buffer.concat(chunks)
			}
			const cbzA = await buildCbz([["page.txt", [1, 1, 1]]])
			const cbzB = await buildCbz([["page.txt", [2, 2, 2]]])
			for (const [id, cbz] of [
				["res-a", cbzA],
				["res-b", cbzB],
			] as const) {
				const dir = paths.latest.resource(id)
				await mkdir(dir, { recursive: true })
				await writeFile(join(dir, "book.cbz"), cbz)
			}

			const viewA = buildSourceArtifactView(
				{ paths, nestedCdCache: sharedNested, cacheScope: "res-a:1" },
				"res-a",
				1,
				buildDirSpec(paths, "res-a"),
			)
			const viewB = buildSourceArtifactView(
				{ paths, nestedCdCache: sharedNested, cacheScope: "res-b:1" },
				"res-b",
				1,
				buildDirSpec(paths, "res-b"),
			)

			// Same outer name, same inner name — but the shared cache must
			// never serve one resource's listing for the other.
			expect([...(await viewA.readEntry("book.cbz!page.txt"))]).toEqual([
				1, 1, 1,
			])
			expect([...(await viewB.readEntry("book.cbz!page.txt"))]).toEqual([
				2, 2, 2,
			])
			expect([...(await viewA.readEntry("book.cbz!page.txt"))]).toEqual([
				1, 1, 1,
			])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("listEntries is invalidated when the folder changes", async () => {
		const root = mkdtempSync(join(tmpdir(), "src-view-list-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			const resId = "res-list"
			const dir = paths.latest.resource(resId)
			await mkdir(dir, { recursive: true })
			await writeEntry(dir, "a.txt", Buffer.from("x"))

			const view = buildSourceArtifactView(
				{ paths },
				resId,
				1,
				buildDirSpec(paths, resId),
			)
			expect(await view.listEntries()).toEqual(["a.txt"])

			// A commit-replace lands new content in the same folder path;
			// the memoized listing must notice via the stat signature.
			await writeEntry(dir, "b.txt", Buffer.from("y"))
			expect(await view.listEntries()).toEqual(["a.txt", "b.txt"])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("path traversal rejection", () => {
	test("literal paths cannot escape the resource folder", async () => {
		const root = mkdtempSync(join(tmpdir(), "src-view-trav-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			const resId = "res-trav"
			await mkdir(paths.latest.resource(resId), { recursive: true })
			await writeEntry(paths.latest.resource(resId), "a.txt", Buffer.from("x"))
			await writeEntry(root, "secret.txt", Buffer.from("top-secret"))

			const view = buildSourceArtifactView(
				{ paths },
				resId,
				1,
				buildDirSpec(paths, resId),
			)

			for (const evil of ["../secret.txt", "..\\secret.txt"]) {
				await expect(view.readEntry(evil)).rejects.toThrow()
				await expect(view.readEntrySlice(evil, 0, 1)).rejects.toThrow()
				await expect(view.openEntryStream(evil)).rejects.toThrow()
				await expect(view.resolveByteRange(evil)).rejects.toThrow()
			}
			// The secret stays unreadable through the view.
			await expect(view.readEntry("../secret.txt")).rejects.toThrow()
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("missing entries surface a notFound domain error", async () => {
		const root = mkdtempSync(join(tmpdir(), "src-view-miss-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			const resId = "res-miss"
			await mkdir(paths.latest.resource(resId), { recursive: true })
			const view = buildSourceArtifactView(
				{ paths },
				resId,
				1,
				buildDirSpec(paths, resId),
			)
			await expect(view.readEntry("nope.bin")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("container addressing (outer!inner)", () => {
	test("reads, slices and streams nested deflate entries", async () => {
		const root = mkdtempSync(join(tmpdir(), "src-view-virtual-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			const resId = "res-virtual"
			await mkdir(paths.latest.resource(resId), { recursive: true })
			// A deflated cbz as a bare top-level file.
			const inner = new yazl.ZipFile()
			inner.addBuffer(Buffer.from([1, 2, 3, 4, 5]), "Ch1/001.jpg")
			inner.addBuffer(Buffer.from([6, 7]), "Ch1/002.jpg")
			inner.end()
			const cbzChunks: Buffer[] = []
			for await (const chunk of inner.outputStream) {
				cbzChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
			}
			await writeEntry(
				paths.latest.resource(resId),
				"book.cbz",
				Buffer.concat(cbzChunks),
			)

			const view = buildSourceArtifactView(
				{ paths },
				resId,
				1,
				buildDirSpec(paths, resId),
			)

			// The whole inner entry.
			const full = await view.readEntry("book.cbz!Ch1/001.jpg")
			expect([...full]).toEqual([1, 2, 3, 4, 5])

			// A bounded head slice — must not read the whole entry.
			const head = await view.readEntrySlice("book.cbz!Ch1/002.jpg", 0, 2)
			expect([...head]).toEqual([6, 7])

			// Streamed with the decompressed size.
			const { stream, size } = await view.openEntryStream(
				"book.cbz!Ch1/002.jpg",
			)
			expect(size).toBe(2)
			const streamed = await buffer(stream)
			expect([...streamed]).toEqual([6, 7])

			// Materialization for seek-dependent consumers (ffmpeg etc.).
			const materialized = await view.withMaterializedEntry(
				"book.cbz!Ch1/001.jpg",
				async (path) => path,
			)
			const cached = await readFile(materialized)
			expect([...cached]).toEqual([1, 2, 3, 4, 5])

			// Virtual entries report their decompressed size but have no
			// byte window inside the archive.
			await expect(
				view.resolveByteRange("book.cbz!Ch1/001.jpg"),
			).resolves.toEqual({ size: 5 })

			// A literal file whose name contains `!` still resolves.
			const resId2 = "res-virtual-2"
			await mkdir(paths.latest.resource(resId2), { recursive: true })
			await writeEntry(
				paths.latest.resource(resId2),
				"weird!name.txt",
				Buffer.from("weird"),
			)
			const view2 = buildSourceArtifactView(
				{ paths },
				resId2,
				1,
				buildDirSpec(paths, resId2),
			)
			expect((await view2.readEntry("weird!name.txt")).toString()).toBe("weird")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
