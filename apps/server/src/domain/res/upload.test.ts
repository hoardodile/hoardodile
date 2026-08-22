import { execFileSync } from "node:child_process"
import {
	createReadStream,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { crc32 } from "node:zlib"
import {
	createStoragePaths,
	type StoragePaths,
} from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { buildResourceUploads, type ResUploads } from "./upload.ts"

/** The bundled 7-Zip binary path, or undefined when unavailable. */
function sevenZipBin(): string | undefined {
	const fromEnv = process.env["7Z_BIN_PATH"]
	if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
	try {
		const mod: unknown = createRequire(import.meta.url)("@hoardodile/7z-bin")
		return typeof mod === "string" && mod.length > 0 ? mod : undefined
	} catch {
		return undefined
	}
}

const sevenZipUnavailable = sevenZipBin() === undefined

/** Build a minimal STORED (method=0) zip in memory. */
function buildStoredZip(
	entries: readonly (readonly [string, Buffer])[],
): Buffer {
	const localChunks: Buffer[] = []
	const centralChunks: Buffer[] = []
	let offset = 0
	for (const [name, data] of entries) {
		const nameBuf = Buffer.from(name, "utf8")
		const crc = crc32(data)
		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(20, 4)
		local.writeUInt16LE(0, 6)
		local.writeUInt16LE(0, 8) // method = stored
		local.writeUInt16LE(0, 10)
		local.writeUInt16LE(0, 12)
		local.writeUInt32LE(crc, 14)
		local.writeUInt32LE(data.length, 18)
		local.writeUInt32LE(data.length, 22)
		local.writeUInt16LE(nameBuf.length, 26)
		local.writeUInt16LE(0, 28)
		localChunks.push(local, nameBuf, data)
		const central = Buffer.alloc(46)
		central.writeUInt32LE(0x02014b50, 0)
		central.writeUInt16LE(20, 4)
		central.writeUInt16LE(20, 6)
		central.writeUInt16LE(0, 8)
		central.writeUInt16LE(0, 10) // method = stored
		central.writeUInt16LE(0, 12)
		central.writeUInt16LE(0, 14)
		central.writeUInt32LE(crc, 16)
		central.writeUInt32LE(data.length, 20)
		central.writeUInt32LE(data.length, 24)
		central.writeUInt16LE(nameBuf.length, 28)
		central.writeUInt16LE(0, 30)
		central.writeUInt16LE(0, 32)
		central.writeUInt16LE(0, 34)
		central.writeUInt16LE(0, 36)
		central.writeUInt32LE(0, 38)
		central.writeUInt32LE(offset, 42)
		centralChunks.push(central, nameBuf)
		offset += local.length + nameBuf.length + data.length
	}
	const central = Buffer.concat(centralChunks)
	const eocd = Buffer.alloc(22)
	eocd.writeUInt32LE(0x06054b50, 0)
	eocd.writeUInt16LE(0, 4)
	eocd.writeUInt16LE(0, 6)
	eocd.writeUInt16LE(entries.length, 8)
	eocd.writeUInt16LE(entries.length, 10)
	eocd.writeUInt32LE(central.length, 12)
	eocd.writeUInt32LE(offset, 16)
	eocd.writeUInt16LE(0, 20)
	return Buffer.concat([...localChunks, central, eocd])
}

function streamOf(data: string): Readable {
	return Readable.from(Buffer.from(data, "utf8"))
}

async function dirEntries(path: string): Promise<string[]> {
	return readdir(path)
}

async function fileContent(path: string): Promise<string> {
	return (await readFile(path)).toString("utf8")
}

describe("resource uploads", () => {
	let root: string
	let paths: StoragePaths
	let uploads: ResUploads

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-uploads-"))
		paths = createStoragePaths({ root })
		uploads = buildResourceUploads(
			paths,
			{
				maxArchiveExtractedBytes: Number.MAX_SAFE_INTEGER,
			},
			{ current: false },
		)
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("ordered N=1 commits as a bare file with its original name", async () => {
		const { fileId } = await uploads.stageSingleFile(
			"only.txt",
			streamOf("hello"),
		)
		const result = await uploads.commitOrderedByIds(
			"res-single",
			[fileId],
			["only.txt"],
		)
		expect(existsSync(result.dirPath)).toBe(true)
		expect(await fileContent(join(result.dirPath, "data", "only.txt"))).toBe(
			"hello",
		)
		// Pool file consumed on commit.
		await expect(uploads.resolveStagedFile(fileId)).resolves.toBeUndefined()
	})

	test("ordered N=1 with a `.zip` name keeps the zip as a bare file", async () => {
		const { fileId } = await uploads.stageSingleFile(
			"payload.zip",
			streamOf("ZIPDATA"),
		)
		const result = await uploads.commitOrderedByIds(
			"res-single-zip",
			[fileId],
			["payload.zip"],
		)
		expect(await fileContent(join(result.dirPath, "data", "payload.zip"))).toBe(
			"ZIPDATA",
		)
	})

	test("unsanitizable names fall back to a generated name", async () => {
		const { fileId } = await uploads.stageSingleFile("a.txt", streamOf("X"))
		const result = await uploads.commitOrderedByIds(
			"res-fallback",
			[fileId],
			["../escape"],
		)
		const names = (await dirEntries(join(result.dirPath, "data"))).filter(
			(n) => n !== ".order",
		)
		expect(names.length).toBe(1)
		expect(names[0]).not.toContain("..")
	})

	test("ordered N>=2 commits as bare files with original names", async () => {
		const a = await uploads.stageSingleFile("first.png", streamOf("AAA"))
		const b = await uploads.stageSingleFile("middle.JPG", streamOf("BB"))
		const c = await uploads.stageSingleFile("last.webp", streamOf("C"))
		const result = await uploads.commitOrderedByIds(
			"res-zip",
			[a.fileId, b.fileId, c.fileId],
			["first.png", "middle.JPG", "last.webp"],
		)
		const names = (await dirEntries(join(result.dirPath, "data"))).sort()
		expect(names).toEqual([".order", "first.png", "last.webp", "middle.JPG"])
		expect(await fileContent(join(result.dirPath, "data", "first.png"))).toBe(
			"AAA",
		)
	})

	test("name collisions get a -N suffix", async () => {
		const a = await uploads.stageSingleFile("a.png", streamOf("A"))
		const b = await uploads.stageSingleFile("a.png", streamOf("B"))
		const result = await uploads.commitOrderedByIds(
			"res-collision",
			[a.fileId, b.fileId],
			["a.png", "a.png"],
		)
		const names = (await dirEntries(join(result.dirPath, "data"))).sort()
		expect(names).toEqual([".order", "a-1.png", "a.png"])
	})

	test("ordered uploads with subdirectory names install nested", async () => {
		const a = await uploads.stageSingleFile("a.txt", streamOf("A"))
		const b = await uploads.stageSingleFile("b.txt", streamOf("B"))
		const result = await uploads.commitOrderedByIds(
			"res-nested",
			[a.fileId, b.fileId],
			["dir/a.txt", "dir/sub/b.txt"],
		)
		expect(
			await fileContent(join(result.dirPath, "data", "dir", "a.txt")),
		).toBe("A")
		expect(
			await fileContent(join(result.dirPath, "data", "dir", "sub", "b.txt")),
		).toBe("B")
	})

	test("ordered uploads prefix Windows reserved names", async () => {
		const { fileId } = await uploads.stageSingleFile("CON.txt", streamOf("X"))
		const result = await uploads.commitOrderedByIds(
			"res-reserved",
			[fileId],
			["CON.txt"],
		)
		expect(await fileContent(join(result.dirPath, "data", "_CON.txt"))).toBe(
			"X",
		)
	})

	test("ordered uploads cap overlong CJK segments by bytes", async () => {
		const long = `${"中".repeat(200)}.txt`
		const { fileId } = await uploads.stageSingleFile(long, streamOf("X"))
		const result = await uploads.commitOrderedByIds(
			"res-long",
			[fileId],
			[long],
		)
		const names = (await dirEntries(join(result.dirPath, "data"))).filter(
			(n) => n !== ".order",
		)
		expect(names.length).toBe(1)
		const name = names[0]!
		expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(243)
	})

	test("ordered uploads normalize names to NFC", async () => {
		const decomposed = "cafe\u0301.txt"
		const { fileId } = await uploads.stageSingleFile(decomposed, streamOf("X"))
		const result = await uploads.commitOrderedByIds(
			"res-nfc",
			[fileId],
			[decomposed],
		)
		expect(
			await fileContent(join(result.dirPath, "data", "caf\u00e9.txt")),
		).toBe("X")
	})

	test("batch file-vs-directory prefix collisions resolve deterministically", async () => {
		const x = await uploads.stageSingleFile("x", streamOf("FILE-X"))
		const y = await uploads.stageSingleFile("y.txt", streamOf("NESTED-Y"))
		const result = await uploads.commitOrderedByIds(
			"res-prefix",
			[x.fileId, y.fileId],
			["x", "x/y.txt"],
		)
		expect(await fileContent(join(result.dirPath, "data", "x"))).toBe("FILE-X")
		expect(
			await fileContent(join(result.dirPath, "data", "x-1", "y.txt")),
		).toBe("NESTED-Y")
	})

	test("nested entries do not collide with directory ancestors", async () => {
		const a = await uploads.stageSingleFile("a.txt", streamOf("A"))
		const b = await uploads.stageSingleFile("b.txt", streamOf("B"))
		const result = await uploads.commitOrderedByIds(
			"res-dir-ok",
			[a.fileId, b.fileId],
			["src/a.txt", "src/sub/b.txt"],
		)
		expect(
			await fileContent(join(result.dirPath, "data", "src", "a.txt")),
		).toBe("A")
		expect(
			await fileContent(join(result.dirPath, "data", "src", "sub", "b.txt")),
		).toBe("B")
	})

	test("ordered commits write an order manifest of the final names", async () => {
		const a = await uploads.stageSingleFile("b.png", streamOf("B"))
		const b = await uploads.stageSingleFile("a.png", streamOf("A"))
		const c = await uploads.stageSingleFile("a.png", streamOf("A2"))
		const result = await uploads.commitOrderedByIds(
			"res-order-manifest",
			[a.fileId, b.fileId, c.fileId],
			["b.png", "a.png", "a.png"],
		)
		// Upload order, with the collision suffix applied to the final name.
		expect(await fileContent(join(result.dirPath, "data", ".order"))).toBe(
			JSON.stringify(["b.png", "a.png", "a-1.png"]),
		)
	})

	test("archive upload is installed as-is under its original filename", async () => {
		const zipBytes = buildStoredZip([
			["a.png", Buffer.from("PNG-A")],
			["nested/b.txt", Buffer.from("NESTED-B")],
		])
		const { fileId } = await uploads.stageArchive(Readable.from(zipBytes))
		const result = await uploads.commitArchiveById(
			"res-arc",
			fileId,
			"vol1.cbz",
		)
		const onDisk = await readFile(join(result.dirPath, "data", "vol1.cbz"))
		expect(onDisk.equals(zipBytes)).toBe(true)
		// Only the archive file is on disk — nothing is unpacked, and no
		// order manifest applies to archive-backed resources.
		expect((await dirEntries(join(result.dirPath, "data"))).sort()).toEqual([
			"vol1.cbz",
		])
	})

	test("archive upload keeps DEFLATE entries untouched (no transcode)", async () => {
		const big = Buffer.from("x".repeat(4096))
		const zipBytes = buildStoredZip([["big.txt", big]])
		const { fileId } = await uploads.stageArchive(Readable.from(zipBytes))
		const result = await uploads.commitArchiveById("res-trans", fileId, "a.zip")
		const onDisk = await readFile(join(result.dirPath, "data", "a.zip"))
		expect(onDisk.equals(zipBytes)).toBe(true)
	})

	test("archive upload with a subdirectory filename installs nested", async () => {
		const zipBytes = buildStoredZip([["a.txt", Buffer.from("A")]])
		const { fileId } = await uploads.stageArchive(Readable.from(zipBytes))
		const result = await uploads.commitArchiveById(
			"res-arc-nested",
			fileId,
			"dir/vol1.cbz",
		)
		expect(
			(await readFile(join(result.dirPath, "data", "dir", "vol1.cbz"))).equals(
				zipBytes,
			),
		).toBe(true)
	})

	test("archive upload rejects over-budget archives", async () => {
		const zipBytes = buildStoredZip([["big.txt", Buffer.alloc(4096, 1)]])
		const { fileId } = await uploads.stageArchive(Readable.from(zipBytes))
		const small = buildResourceUploads(
			paths,
			{ maxArchiveExtractedBytes: 100 },
			{ current: false },
		)
		await expect(
			small.commitArchiveById("res-budget", fileId, "a.zip"),
		).rejects.toThrow()
	})

	describe.skipIf(sevenZipUnavailable)("non-zip archive uploads", () => {
		// Vendored RAR5 sample (see plugins/host/testdata/README.md).
		const RAR_FIXTURE = join(
			import.meta.dirname,
			"../../../../../plugins/host/testdata/rar5-multiple-files.rar",
		)

		/** Build a 7z archive with the bundled binary (any content). */
		function buildSevenZip(bytes: Buffer): Buffer {
			const dir = mkdtempSync(join(tmpdir(), "upload-7z-"))
			try {
				writeFileSync(join(dir, "payload.bin"), bytes)
				const archivePath = join(dir, "a.7z")
				execFileSync(
					sevenZipBin()!,
					["a", "-t7z", archivePath, "payload.bin"],
					{
						cwd: dir,
						stdio: "ignore",
					},
				)
				return readFileSync(archivePath)
			} finally {
				rmSync(dir, { recursive: true, force: true })
			}
		}

		test("rar upload is installed as-is under its original filename", async () => {
			const { fileId } = await uploads.stageArchive(
				createReadStream(RAR_FIXTURE),
			)
			const result = await uploads.commitArchiveById(
				"res-rar",
				fileId,
				"vol1.cbr",
			)
			const onDisk = await readFile(join(result.dirPath, "data", "vol1.cbr"))
			expect(onDisk.equals(readFileSync(RAR_FIXTURE))).toBe(true)
		})

		test("7z upload is installed as-is under its original filename", async () => {
			const archiveBytes = buildSevenZip(Buffer.from("payload"))
			const { fileId } = await uploads.stageArchive(Readable.from(archiveBytes))
			const result = await uploads.commitArchiveById(
				"res-7z",
				fileId,
				"vol1.cb7",
			)
			const onDisk = await readFile(join(result.dirPath, "data", "vol1.cb7"))
			expect(onDisk.equals(archiveBytes)).toBe(true)
		})

		test("gzip upload is installed as-is (listable, not addressable)", async () => {
			const { gzipSync } = await import("node:zlib")
			const gzBytes = gzipSync(Buffer.from("compressed payload"))
			const { fileId } = await uploads.stageArchive(Readable.from(gzBytes))
			const result = await uploads.commitArchiveById(
				"res-gz",
				fileId,
				"scan.tgz",
			)
			const onDisk = await readFile(join(result.dirPath, "data", "scan.tgz"))
			expect(onDisk.equals(gzBytes)).toBe(true)
		})

		test("non-zip uploads are rejected over the budget", async () => {
			const { fileId } = await uploads.stageArchive(
				createReadStream(RAR_FIXTURE),
			)
			const small = buildResourceUploads(
				paths,
				{ maxArchiveExtractedBytes: 1024 },
				{ current: false },
			)
			// The sample holds four 4096-byte entries — over a 1 KiB budget.
			await expect(
				small.commitArchiveById("res-rar-budget", fileId, "vol1.cbr"),
			).rejects.toThrow()
		})
	})

	test("commit replaces an existing artifact atomically", async () => {
		const first = await uploads.stageSingleFile("a.txt", streamOf("OLD"))
		const r1 = await uploads.commitOrderedByIds(
			"res-replace",
			[first.fileId],
			["a.txt"],
		)
		expect(await fileContent(join(r1.dirPath, "data", "a.txt"))).toBe("OLD")

		const second = await uploads.stageSingleFile("b.txt", streamOf("NEW"))
		const r2 = await uploads.commitOrderedByIds(
			"res-replace",
			[second.fileId],
			["b.txt"],
		)
		expect(await fileContent(join(r2.dirPath, "data", "b.txt"))).toBe("NEW")

		// The old entry is gone, no `.replacing-*` siblings left over.
		const names = await dirEntries(r2.dirPath)
		expect(names).toEqual(["data"])
		expect(names.some((n) => n.includes(".replacing-"))).toBe(false)
	})

	test("commit replacing keeps metadata dotfiles", async () => {
		await mkdir(paths.latest.resource("res-dot"), { recursive: true })
		await writeFile(
			join(paths.latest.resource("res-dot"), ".cover.jpg"),
			"COVER",
		)
		const a = await uploads.stageSingleFile("a.png", streamOf("A"))
		const r = await uploads.commitOrderedByIds("res-dot", [a.fileId], ["a.png"])
		expect(await fileContent(join(r.dirPath, ".cover.jpg"))).toBe("COVER")
		expect(await fileContent(join(r.dirPath, "data", "a.png"))).toBe("A")
	})

	test("commit honours explicit fileIds order", async () => {
		const a = await uploads.stageSingleFile("a.png", streamOf("A"))
		const b = await uploads.stageSingleFile("b.jpg", streamOf("B"))
		const c = await uploads.stageSingleFile("c.webp", streamOf("C"))

		const result = await uploads.commitOrderedByIds(
			"res-order",
			[c.fileId, a.fileId, b.fileId],
			["c.webp", "a.png", "b.jpg"],
		)
		const names = (await dirEntries(join(result.dirPath, "data"))).sort()
		expect(names).toEqual([".order", "a.png", "b.jpg", "c.webp"])
		expect(await fileContent(join(result.dirPath, "data", ".order"))).toBe(
			JSON.stringify(["c.webp", "a.png", "b.jpg"]),
		)
	})

	test("commit rejects name/fileId length mismatch", async () => {
		const { fileId } = await uploads.stageSingleFile("a.png", streamOf("A"))
		await expect(
			uploads.commitOrderedByIds("res-mismatch", [fileId], []),
		).rejects.toThrow()
	})

	test("commit rejects unknown fileId", async () => {
		const a = await uploads.stageSingleFile("a.png", streamOf("A"))
		await expect(
			uploads.commitOrderedByIds(
				"res-bad-order",
				[a.fileId, "00000000-0000-0000-0000-000000000003"],
				["a.png", "b.png"],
			),
		).rejects.toThrow()
	})

	test("commit rejects empty fileIds", async () => {
		await expect(
			uploads.commitOrderedByIds("res-no-order", [], []),
		).rejects.toThrow()
	})

	test("commit rejects duplicate fileId", async () => {
		const { fileId } = await uploads.stageSingleFile("a.png", streamOf("A"))
		await expect(
			uploads.commitOrderedByIds(
				"res-dup",
				[fileId, fileId],
				["a.png", "a.png"],
			),
		).rejects.toThrow()
	})

	test("commitDirectoryTree copies a folder tree with structure preserved", async () => {
		const src = join(root, "import-src")
		await mkdir(join(src, "sub"), { recursive: true })
		await writeFile(join(src, "top.txt"), "TOP")
		await writeFile(join(src, "sub", "deep.txt"), "DEEP")
		const result = await uploads.commitDirectoryTree("res-tree", src)
		expect(await fileContent(join(result.dirPath, "data", "top.txt"))).toBe(
			"TOP",
		)
		expect(
			await fileContent(join(result.dirPath, "data", "sub", "deep.txt")),
		).toBe("DEEP")
	})

	test("commitDirectoryTree rejects an empty folder", async () => {
		const src = join(root, "import-empty")
		await mkdir(src, { recursive: true })
		await expect(
			uploads.commitDirectoryTree("res-empty-tree", src),
		).rejects.toThrow()
	})

	test("discardStagedFile removes a staged file", async () => {
		const { fileId } = await uploads.stageSingleFile("x.png", streamOf("X"))
		await expect(uploads.resolveStagedFile(fileId)).resolves.toBeDefined()
		const removed = await uploads.discardStagedFile(fileId)
		expect(removed).toBe(true)
		await expect(uploads.resolveStagedFile(fileId)).resolves.toBeUndefined()
	})

	test("discardStagedFile returns false for unknown fileId", async () => {
		const removed = await uploads.discardStagedFile(
			"00000000-0000-0000-0000-000000000099",
		)
		expect(removed).toBe(false)
	})

	test("empty archive upload is rejected", async () => {
		await expect(
			uploads.stageArchive(Readable.from(Buffer.alloc(0))),
		).rejects.toThrow()
	})

	test("interrupted upload (no commit) leaves no resource directory", async () => {
		const { fileId } = await uploads.stageSingleFile("x.png", streamOf("X"))
		await uploads.discardStagedFile(fileId)
		expect(existsSync(paths.latest.resource("ghost"))).toBe(false)
	})
})
