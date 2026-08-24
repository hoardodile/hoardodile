import { createWriteStream, existsSync, mkdtempSync, rmSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { buffer } from "node:stream/consumers"
import { deflateRawSync } from "node:zlib"
import { afterEach, describe, expect, test, vi } from "vitest"
import yazl from "yazl"
import * as sevenZip from "./7z.ts"
import {
	assertExtractedTree,
	extractArchiveInto,
	normalizeExtractedTree,
} from "./extract.ts"
import { listArchiveEntries, validateArchiveBudget } from "./listing.ts"
import { streamStoredZip } from "./pack.ts"
import {
	createFileArchiveSource,
	listZipEntries,
	openZipEntryStream,
} from "./zip-entries.ts"

const sevenZipAvailable = sevenZip.resolveSevenZipPath() !== undefined

let roots: string[] = []

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "archive-ops-"))
	roots.push(root)
	return root
}

afterEach(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true })
	roots = []
})

/** Build a zip buffer with yazl; `deflate` controls per-entry compression. */
async function buildZip(
	entries: readonly (readonly [string, string])[],
	deflate = false,
): Promise<Buffer> {
	const zip = new yazl.ZipFile()
	for (const [name, content] of entries) {
		zip.addBuffer(Buffer.from(content), name, { compress: deflate })
	}
	zip.end()
	const chunks: Buffer[] = []
	for await (const chunk of zip.outputStream) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
	}
	return Buffer.concat(chunks)
}

type RawEntry = {
	readonly name: string
	readonly content: string
	/** General-purpose flags; default 0x0800 (UTF-8 names). */
	readonly nameFlags?: number
	/** DEFLATE the content (method 8) instead of STORED. */
	readonly deflate?: boolean
	/** External attributes (CD field); unix mode lives in the high 16 bits. */
	readonly externalAttrs?: number
}

/**
 * Hand-rolled zip writer that accepts any entry name (yazl rejects
 * traversal/absolute names outright) and any flags/attributes â€” used to
 * feed the safety guards in `extractArchiveInto`, legacy cp437 names,
 * encrypted entries and symlink-attribute entries.
 */
function buildRawStoredZip(entries: readonly RawEntry[]): Buffer {
	const crcTable: number[] = []
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		}
		crcTable[n] = c >>> 0
	}
	function crc32(bytes: Uint8Array): number {
		let c = 0xffffffff
		for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
		return (c ^ 0xffffffff) >>> 0
	}

	const chunks: Buffer[] = []
	const cd: Buffer[] = []
	let offset = 0
	for (const entry of entries) {
		const data = Buffer.from(entry.content)
		const nameBuf = Buffer.from(entry.name, "latin1")
		const crc = crc32(data)
		const flags = entry.nameFlags ?? 0x0800
		const method = entry.deflate === true ? 8 : 0
		const raw = method === 8 ? deflateRawSync(data) : data
		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(20, 4)
		local.writeUInt16LE(flags, 6)
		local.writeUInt16LE(method, 8)
		local.writeUInt32LE(crc, 14)
		local.writeUInt32LE(raw.length, 18)
		local.writeUInt32LE(data.length, 22)
		local.writeUInt16LE(nameBuf.length, 26)
		chunks.push(local, nameBuf, raw)

		const central = Buffer.alloc(46)
		central.writeUInt32LE(0x02014b50, 0)
		central.writeUInt16LE(20, 4)
		central.writeUInt16LE(20, 6)
		central.writeUInt16LE(flags, 8)
		central.writeUInt16LE(method, 10)
		central.writeUInt32LE(crc, 16)
		central.writeUInt32LE(raw.length, 20)
		central.writeUInt32LE(data.length, 24)
		central.writeUInt16LE(nameBuf.length, 28)
		central.writeUInt32LE((entry.externalAttrs ?? 0) >>> 0, 38)
		central.writeUInt32LE(offset, 42)
		cd.push(central, nameBuf)
		offset += 30 + nameBuf.length + raw.length
	}

	const cdBuf = Buffer.concat(cd)
	const eocd = Buffer.alloc(22)
	eocd.writeUInt32LE(0x06054b50, 0)
	eocd.writeUInt16LE(0, 4)
	eocd.writeUInt16LE(0, 6)
	eocd.writeUInt16LE(entries.length, 8)
	eocd.writeUInt16LE(entries.length, 10)
	eocd.writeUInt32LE(cdBuf.length, 12)
	eocd.writeUInt32LE(offset, 16)
	return Buffer.concat([...chunks, cdBuf, eocd])
}

/** Read one entry's decompressed content back out of a zip on disk. */
async function readEntryContent(
	zipPath: string,
	name: string,
): Promise<Buffer> {
	const records = await listZipEntries(zipPath)
	const record = records.find((r) => r.name === name)
	if (record === undefined) throw new Error(`no entry ${name}`)
	const source = await createFileArchiveSource(zipPath)
	return buffer(openZipEntryStream(source, record))
}

describe("extractArchiveInto", () => {
	async function extract(
		zip: Buffer,
		destDir: string,
		maxBytes = 1_000_000,
	): Promise<void> {
		await extractArchiveInto(Readable.from(zip), destDir, { maxBytes })
	}

	test("extracts entries into nested directories", async () => {
		const root = tempRoot()
		const dest = join(root, "out")
		await extract(
			await buildZip(
				[
					["dir/a.txt", "alpha"],
					["dir/sub/b.bin", "beta"],
					["c.txt", "gamma"],
				],
				true,
			),
			dest,
		)

		expect(await readFile(join(dest, "dir", "a.txt"), "utf8")).toBe("alpha")
		expect(await readFile(join(dest, "dir", "sub", "b.bin"), "utf8")).toBe(
			"beta",
		)
		expect(await readFile(join(dest, "c.txt"), "utf8")).toBe("gamma")
	})

	test("rejects zip-slip entries", async () => {
		const root = tempRoot()
		const dest = join(root, "out")
		await expect(
			extract(
				buildRawStoredZip([{ name: "../escape.txt", content: "evil" }]),
				dest,
			),
		).rejects.toMatchObject({
			kind: "resource.archive_invalid_entry",
		})
		expect(existsSync(join(root, "escape.txt"))).toBe(false)
	})

	test("rejects absolute-path entries", async () => {
		const root = tempRoot()
		const dest = join(root, "out")
		await expect(
			extract(
				buildRawStoredZip([{ name: "/etc/passwd", content: "evil" }]),
				dest,
			),
		).rejects.toMatchObject({
			kind: "resource.archive_invalid_entry",
		})
	})

	test("rejects archives over the byte budget", async () => {
		const root = tempRoot()
		const dest = join(root, "out")
		await expect(
			extract(
				await buildZip(
					[
						["a.txt", "alpha"],
						["b.txt", "beta"],
					],
					true,
				),
				dest,
				5,
			),
		).rejects.toMatchObject({
			kind: "resource.archive_too_large",
		})
	})

	test("rejects garbage bytes as an unsupported archive", async () => {
		const root = tempRoot()
		const dest = join(root, "out")
		await expect(
			extract(Buffer.from("definitely not an archive"), dest),
		).rejects.toMatchObject({ kind: "resource.archive_open_failed" })
	})

	test("rejects a corrupt zip with the archive-open error", async () => {
		const root = tempRoot()
		const dest = join(root, "out")
		const zip = await buildZip([["a.txt", "alpha"]], true)
		const corrupted = Buffer.concat([zip.subarray(0, zip.length / 2)])
		await expect(extract(corrupted, dest)).rejects.toMatchObject({
			kind: "resource.archive_open_failed",
		})
	})

	test("rejects password-protected archives", async () => {
		const root = tempRoot()
		const dest = join(root, "out")
		// DEFLATE + encryption bit: real encrypted zips are deflated, and
		// the sizes stay consistent for the parsers.
		const encrypted = buildRawStoredZip([
			{
				name: "secret.txt",
				content: "top secret",
				deflate: true,
				nameFlags: 0x0801,
			},
		])
		// The 7-Zip path rejects at the listing pre-check; the yauzl
		// fallback rejects when the entry stream opens â€” same taxonomy
		// intent, different kind. Assert the shared message contract.
		await expect(extract(encrypted, dest)).rejects.toThrow(/encrypt/i)
	})
})

describe.skipIf(!sevenZipAvailable)("extractArchiveInto via 7-Zip", () => {
	async function extract(
		zip: Buffer,
		destDir: string,
		maxBytes = 1_000_000,
	): Promise<void> {
		await extractArchiveInto(Readable.from(zip), destDir, { maxBytes })
	}

	test("decodes legacy cp437 entry names instead of the system locale", async () => {
		const root = tempRoot()
		const dest = join(root, "out")
		// "cafÃ©.jpg" with the name stored as cp437 bytes (Ã© = 0x82) and no
		// UTF-8 flag â€” the exact case that breaks under a GBK console.
		const name = Buffer.from([
			0x63, 0x61, 0x66, 0x82, 0x2e, 0x6a, 0x70, 0x67,
		]).toString("latin1")
		await extract(
			buildRawStoredZip([{ name, content: "x", nameFlags: 0 }]),
			dest,
		)
		expect(await readFile(join(dest, "caf\u00e9.jpg"), "utf8")).toBe("x")
	})
})

describe.skipIf(!sevenZipAvailable || process.platform === "win32")(
	"extractArchiveInto via 7-Zip symlinks",
	() => {
		test("refuses symlink entries after extraction", async () => {
			const root = tempRoot()
			const dest = join(root, "out")
			// Unix symlink mode in the external attributes: 7-Zip recreates
			// the link on extraction, and the post-extract scan must refuse
			// it. Windows is skipped: 7-Zip cannot create symlinks there
			// without elevation, so the fixture outcome is platform-bound.
			await expect(
				extractArchiveInto(
					Readable.from(
						buildRawStoredZip([
							{
								name: "link.jpg",
								content: "outside",
								externalAttrs: 0o120777 << 16,
							},
						]),
					),
					dest,
					{ maxBytes: 1_000_000 },
				),
			).rejects.toMatchObject({ kind: "resource.archive_invalid_entry" })
		})
	},
)

describe("extractArchiveInto without 7-Zip", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("falls back to the yauzl streaming path", async () => {
		vi.spyOn(sevenZip, "resolveSevenZipPath").mockReturnValue(undefined)
		const root = tempRoot()
		const dest = join(root, "out")
		await extractArchiveInto(
			Readable.from(
				await buildZip(
					[
						["dir/a.txt", "alpha"],
						["c.txt", "gamma"],
					],
					true,
				),
			),
			dest,
			{ maxBytes: 1_000_000 },
		)
		expect(await readFile(join(dest, "dir", "a.txt"), "utf8")).toBe("alpha")
	})

	test("fallback still rejects zip-slip and unsafe names", async () => {
		vi.spyOn(sevenZip, "resolveSevenZipPath").mockReturnValue(undefined)
		const root = tempRoot()
		const dest = join(root, "out")
		await expect(
			extractArchiveInto(
				Readable.from(
					buildRawStoredZip([{ name: "../escape.txt", content: "evil" }]),
				),
				dest,
				{ maxBytes: 1_000_000 },
			),
		).rejects.toMatchObject({ kind: "resource.archive_invalid_entry" })
		expect(existsSync(join(root, "escape.txt"))).toBe(false)
	})

	test("fallback still enforces the byte budget mid-stream", async () => {
		vi.spyOn(sevenZip, "resolveSevenZipPath").mockReturnValue(undefined)
		const root = tempRoot()
		const dest = join(root, "out")
		await expect(
			extractArchiveInto(
				Readable.from(await buildZip([["a.txt", "alpha"]], true)),
				dest,
				{ maxBytes: 3 },
			),
		).rejects.toMatchObject({ kind: "resource.archive_too_large" })
	})
})

describe("listArchiveEntries", () => {
	test("lists zip entries with uncompressed sizes", async () => {
		const root = tempRoot()
		const zipPath = join(root, "a.zip")
		const { writeFile } = await import("node:fs/promises")
		await writeFile(zipPath, await buildZip([["a.txt", "alpha"]], true))
		expect(await listArchiveEntries(zipPath)).toEqual([
			{ name: "a.txt", sizeBytes: 5 },
		])
	})

	test("rejects unknown content", async () => {
		const root = tempRoot()
		const path = join(root, "garbage.bin")
		const { writeFile } = await import("node:fs/promises")
		await writeFile(path, Buffer.from("definitely not an archive"))
		await expect(listArchiveEntries(path)).rejects.toMatchObject({
			kind: "resource.archive_open_failed",
		})
	})

	test.skipIf(!sevenZipAvailable)(
		"lists rar archives through 7-Zip",
		async () => {
			const root = tempRoot()
			const fixture = join(
				import.meta.dirname,
				"../../testdata/rar5-multiple-files.rar",
			)
			const rarPath = join(root, "sample.rar")
			const { copyFile } = await import("node:fs/promises")
			await copyFile(fixture, rarPath)
			const entries = await listArchiveEntries(rarPath)
			expect(entries.map((e) => e.name).sort()).toEqual([
				"test1.bin",
				"test2.bin",
				"test3.bin",
				"test4.bin",
			])
			for (const entry of entries) expect(entry.sizeBytes).toBe(4096)
		},
	)

	test.skipIf(!sevenZipAvailable)(
		"lists gzip as its single stream",
		async () => {
			const root = tempRoot()
			const gzPath = join(root, "a.gz")
			const { writeFile } = await import("node:fs/promises")
			const { gzipSync } = await import("node:zlib")
			await writeFile(gzPath, gzipSync(Buffer.from("hello gzip content")))
			const entries = await listArchiveEntries(gzPath)
			expect(entries).toHaveLength(1)
			expect(entries[0]!.sizeBytes).toBe(18)
		},
	)

	test("rejects non-zip archives without the 7-Zip binary", async () => {
		vi.spyOn(sevenZip, "resolveSevenZipPath").mockReturnValue(undefined)
		const root = tempRoot()
		const fixture = join(
			import.meta.dirname,
			"../../testdata/rar5-multiple-files.rar",
		)
		const rarPath = join(root, "sample.rar")
		const { copyFile } = await import("node:fs/promises")
		await copyFile(fixture, rarPath)
		await expect(listArchiveEntries(rarPath)).rejects.toMatchObject({
			kind: "resource.archive_open_failed",
		})
		vi.restoreAllMocks()
	})
})

describe("validateArchiveBudget", () => {
	test("accepts zips within the budget and rejects over it", async () => {
		const root = tempRoot()
		const zipPath = join(root, "a.zip")
		const { writeFile } = await import("node:fs/promises")
		await writeFile(zipPath, await buildZip([["a.txt", "alpha"]], true))
		await validateArchiveBudget(zipPath, 100)
		await expect(validateArchiveBudget(zipPath, 3)).rejects.toMatchObject({
			kind: "resource.archive_too_large",
		})
	})

	test("rejects non-archives", async () => {
		const root = tempRoot()
		const path = join(root, "garbage.bin")
		await import("node:fs/promises").then(({ writeFile }) =>
			writeFile(path, Buffer.from("definitely not an archive")),
		)
		await expect(validateArchiveBudget(path, 1000)).rejects.toMatchObject({
			kind: "resource.archive_open_failed",
		})
	})

	test.skipIf(!sevenZipAvailable)(
		"accepts rar archives within the budget",
		async () => {
			const root = tempRoot()
			const fixture = join(
				import.meta.dirname,
				"../../testdata/rar5-multiple-files.rar",
			)
			const rarPath = join(root, "sample.rar")
			await import("node:fs/promises").then(({ copyFile }) =>
				copyFile(fixture, rarPath),
			)
			// The sample holds four 4096-byte entries.
			await validateArchiveBudget(rarPath, 4 * 4096)
			await expect(
				validateArchiveBudget(rarPath, 4 * 4096 - 1),
			).rejects.toMatchObject({ kind: "resource.archive_too_large" })
		},
	)

	test("rejects non-zip archives without the 7-Zip binary", async () => {
		vi.spyOn(sevenZip, "resolveSevenZipPath").mockReturnValue(undefined)
		const root = tempRoot()
		const fixture = join(
			import.meta.dirname,
			"../../testdata/rar5-multiple-files.rar",
		)
		const rarPath = join(root, "sample.rar")
		await import("node:fs/promises").then(({ copyFile }) =>
			copyFile(fixture, rarPath),
		)
		await expect(validateArchiveBudget(rarPath, 100_000)).rejects.toMatchObject(
			{ kind: "resource.archive_open_failed" },
		)
		vi.restoreAllMocks()
	})
})

describe("assertExtractedTree", () => {
	test("rejects a planted symlink", async () => {
		const { symlinkSync } = await import("node:fs")
		const root = tempRoot()
		const dir = join(root, "out")
		await mkdir(dir, { recursive: true })
		await mkdir(join(dir, "sub"), { recursive: true })
		await import("node:fs/promises").then(({ writeFile }) =>
			writeFile(join(dir, "sub", "real.txt"), "x"),
		)
		try {
			symlinkSync(join(dir, "sub", "real.txt"), join(dir, "link.txt"))
		} catch {
			// Windows without developer mode cannot create symlinks â€”
			// the guard itself stays covered by the other cases.
			return
		}
		await expect(assertExtractedTree(dir, 1_000_000)).rejects.toMatchObject({
			kind: "resource.archive_invalid_entry",
		})
	})

	test("sums sizes and enforces the byte budget", async () => {
		const root = tempRoot()
		const dir = join(root, "out")
		await mkdir(dir, { recursive: true })
		await import("node:fs/promises").then(({ writeFile }) =>
			writeFile(join(dir, "a.bin"), Buffer.alloc(10)),
		)
		await assertExtractedTree(dir, 10)
		await expect(assertExtractedTree(dir, 9)).rejects.toMatchObject({
			kind: "resource.archive_too_large",
		})
	})
})

describe("streamStoredZip", () => {
	test("packs logical entries incl. zero-length ones", async () => {
		const root = tempRoot()
		const out = join(root, "stream.zip")
		const pack = streamStoredZip([
			{
				name: "empty.bin",
				size: 0,
				openStream: () => Readable.from([]),
			},
			{
				name: "data.bin",
				size: 4,
				openStream: () => Readable.from([Buffer.from("data")]),
			},
		])
		await new Promise<void>((resolveDone, rejectDone) => {
			const stream = createWriteStream(out)
			pack.pipe(stream)
			stream.on("close", resolveDone)
			stream.on("error", rejectDone)
		})

		const records = await listZipEntries(out)
		expect(records.map((r) => r.name)).toEqual(["empty.bin", "data.bin"])
		for (const record of records) {
			expect(record.compressionMethod).toBe(0)
		}
		expect(await readEntryContent(out, "empty.bin")).toEqual(Buffer.alloc(0))
		expect(await readEntryContent(out, "data.bin")).toEqual(Buffer.from("data"))
	})
})

describe("normalizeExtractedTree", () => {
	test("renames macOS %XX-escaped legacy names to the decoded listing name", async () => {
		const root = tempRoot()
		const dest = join(root, "out")
		await mkdir(dest, { recursive: true })
		// macOS stores 7-Zip's raw legacy byte 0x82 as the valid-UTF-8
		// `%82` escape; the listing decoder still reports `café.jpg`.
		await writeFile(join(dest, "caf%82.jpg"), "x")
		await normalizeExtractedTree(dest, {
			legacyZipNames: true,
			expectedNames: ["café.jpg"],
		})
		expect(await readFile(join(dest, "caf\u00e9.jpg"), "utf8")).toBe("x")
	})

	test("renames 7-Zip escape-plane legacy names to the decoded listing name", async () => {
		const root = tempRoot()
		const dest = join(root, "out")
		await mkdir(dest, { recursive: true })
		// 7-Zip represents a legacy byte b it cannot show as UTF-8 with
		// the escape-plane character U+EF00+b; some platform builds write
		// that character verbatim as the file name instead of the raw byte.
		await writeFile(join(dest, "caf\uef82.jpg"), "x")
		await normalizeExtractedTree(dest, {
			legacyZipNames: true,
			expectedNames: ["café.jpg"],
		})
		expect(await readFile(join(dest, "caf\u00e9.jpg"), "utf8")).toBe("x")
	})

	test("leaves a literal %XX name the listing never decoded alone", async () => {
		const root = tempRoot()
		const dest = join(root, "out")
		await mkdir(dest, { recursive: true })
		// A file genuinely named `report%82.jpg`: the recovered name
		// `reporté.jpg` must not be in the listing, so no rename fires.
		await writeFile(join(dest, "report%82.jpg"), "x")
		await normalizeExtractedTree(dest, {
			legacyZipNames: true,
			expectedNames: ["report%82.jpg"],
		})
		expect(await readFile(join(dest, "report%82.jpg"), "utf8")).toBe("x")
	})

	test("never clobbers an entry that already owns the decoded name", async () => {
		const root = tempRoot()
		const dest = join(root, "out")
		await mkdir(dest, { recursive: true })
		// The same archive carries both the escaped shape and the real
		// decoded entry — the real one wins and the escaped one stays.
		await writeFile(join(dest, "caf%82.jpg"), "escaped")
		await writeFile(join(dest, "caf\u00e9.jpg"), "real")
		await normalizeExtractedTree(dest, {
			legacyZipNames: true,
			expectedNames: ["café.jpg"],
		})
		expect(await readFile(join(dest, "caf\u00e9.jpg"), "utf8")).toBe("real")
		expect(await readFile(join(dest, "caf%82.jpg"), "utf8")).toBe("escaped")
	})

	test("renames %XX-escaped names under nested directories", async () => {
		const root = tempRoot()
		const dest = join(root, "out")
		await mkdir(join(dest, "caf%82dir"), { recursive: true })
		await writeFile(join(dest, "caf%82dir", "note%82.txt"), "x")
		// A real `-slt` listing reports the folder entry as well (with a
		// trailing slash), so the expected set carries both paths.
		await normalizeExtractedTree(dest, {
			legacyZipNames: true,
			expectedNames: ["cafédir/", "cafédir/noteé.txt"],
		})
		expect(
			await readFile(join(dest, "caf\u00e9dir", "note\u00e9.txt"), "utf8"),
		).toBe("x")
		expect(existsSync(join(dest, "caf%82dir"))).toBe(false)
	})
})
