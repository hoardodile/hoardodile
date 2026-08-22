import { execFileSync } from "node:child_process"
import { createWriteStream, mkdtempSync } from "node:fs"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { crc32 } from "node:zlib"
import { afterEach, describe, expect, test } from "vitest"
import yazl from "yazl"

const SCRIPT_PATH = fileURLToPath(
	new URL("../../../../scripts/migrate-hoard-to-files.mjs", import.meta.url),
)

const tempRoots: string[] = []

function withTempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "migrate-script-"))
	tempRoots.push(root)
	return root
}

afterEach(async () => {
	for (const root of tempRoots) {
		await rm(root, { recursive: true, force: true }).catch(() => {})
	}
	tempRoots.length = 0
})

async function buildZip(
	entries: readonly (readonly [string, string])[],
	deflate: boolean,
	options: { readonly forceZip64Eocd?: boolean } = {},
): Promise<Buffer> {
	const zip = new yazl.ZipFile()
	for (const [name, content] of entries) {
		zip.addBuffer(Buffer.from(content), name, { compress: deflate })
	}
	zip.end({
		forceZip64Format: options.forceZip64Eocd === true,
		comment: "",
	})
	const chunks: Buffer[] = []
	for await (const chunk of zip.outputStream) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
	}
	return Buffer.concat(chunks)
}

/** Zip where every entry uses ZIP64 central-directory fields. */
async function buildEntryZip64Zip(
	entries: readonly (readonly [string, string, boolean?])[],
): Promise<Buffer> {
	const zip = new yazl.ZipFile()
	for (const [name, content, deflate] of entries) {
		zip.addBuffer(Buffer.from(content), name, {
			compress: deflate ?? true,
			forceZip64Format: true,
		})
	}
	zip.end()
	const chunks: Buffer[] = []
	for await (const chunk of zip.outputStream) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
	}
	return Buffer.concat(chunks)
}

/**
 * Hand-rolled STORED zip writer that accepts any entry name (yazl
 * rejects traversal/absolute/control-char names outright). Feeds the
 * migration script's sanitization guards. `corruptData` flips the first
 * byte of every entry while keeping the central-directory CRC honest —
 * a corrupt-payload fixture for the CRC verification.
 */
function buildRawStoredZip(
	entries: readonly (readonly [string, string])[],
	corruptData = false,
): Buffer {
	const crcTable: number[] = []
	for (let n = 0; n < 256; n += 1) {
		let c = n
		for (let k = 0; k < 8; k += 1) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		}
		crcTable[n] = c >>> 0
	}
	function crc32(bytes: Uint8Array): number {
		let c = 0xffffffff
		for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
		return (c ^ 0xffffffff) >>> 0
	}
	const localChunks: Buffer[] = []
	const centralChunks: Buffer[] = []
	let offset = 0
	for (const [name, content] of entries) {
		const data = Buffer.from(content)
		const crc = crc32(data)
		if (corruptData && data.length > 0) {
			data.writeUInt8(data.readUInt8(0) ^ 0xff, 0)
		}
		const nameBuf = Buffer.from(name, "utf8")
		const flags = 0x0800 // UTF-8 names
		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(20, 4)
		local.writeUInt16LE(flags, 6)
		local.writeUInt32LE(crc, 14)
		local.writeUInt32LE(data.length, 18)
		local.writeUInt32LE(data.length, 22)
		local.writeUInt16LE(nameBuf.length, 26)
		localChunks.push(local, nameBuf, data)

		const central = Buffer.alloc(46)
		central.writeUInt32LE(0x02014b50, 0)
		central.writeUInt16LE(20, 4)
		central.writeUInt16LE(20, 6)
		central.writeUInt16LE(flags, 8)
		central.writeUInt32LE(crc, 16)
		central.writeUInt32LE(data.length, 20)
		central.writeUInt32LE(data.length, 24)
		central.writeUInt16LE(nameBuf.length, 28)
		central.writeUInt32LE(offset, 42)
		centralChunks.push(central, nameBuf)
		offset += 30 + nameBuf.length + data.length
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
	return Buffer.concat([...localChunks, central, eocd])
}

/** Create `source.hoard` inside `dir` and return its absolute path. */
async function seedArchive(
	dir: string,
	entries: readonly (readonly [string, string])[],
	deflate = true,
	options: { readonly forceZip64Eocd?: boolean } = {},
): Promise<string> {
	await mkdir(dir, { recursive: true })
	const archivePath = join(dir, "source.hoard")
	await writeFile(archivePath, await buildZip(entries, deflate, options))
	return archivePath
}

/**
 * STORED zip whose central directory sits past the 2 GiB boundary while
 * the entry data lives at offset 0. Writing at a high offset leaves an
 * unallocated hole (sparse) on NTFS/ext4, so the fixture costs almost no
 * disk space but regresses the `fs.read` Int32-position assertion crash.
 */
const BIG_OFFSET = 2 ** 31 + 256
async function buildBigOffsetZip(zipPath: string): Promise<void> {
	const name = "a.txt"
	const data = Buffer.from("alpha")
	const nameBuf = Buffer.from(name, "utf8")
	const local = Buffer.alloc(30)
	local.writeUInt32LE(0x04034b50, 0)
	local.writeUInt16LE(20, 4)
	local.writeUInt16LE(0x0800, 6)
	local.writeUInt32LE(crc32(data), 14)
	local.writeUInt32LE(data.length, 18)
	local.writeUInt32LE(data.length, 22)
	local.writeUInt16LE(nameBuf.length, 26)

	const central = Buffer.alloc(46)
	central.writeUInt32LE(0x02014b50, 0)
	central.writeUInt16LE(20, 4)
	central.writeUInt16LE(20, 6)
	central.writeUInt16LE(0x0800, 8)
	central.writeUInt32LE(crc32(data), 16)
	central.writeUInt32LE(data.length, 20)
	central.writeUInt32LE(data.length, 24)
	central.writeUInt16LE(nameBuf.length, 28)
	central.writeUInt32LE(0, 42) // local header offset 0

	const eocd = Buffer.alloc(22)
	eocd.writeUInt32LE(0x06054b50, 0)
	eocd.writeUInt16LE(1, 8)
	eocd.writeUInt16LE(1, 10)
	eocd.writeUInt32LE(central.length + nameBuf.length, 12)
	eocd.writeUInt32LE(BIG_OFFSET, 16)

	await writeFile(zipPath, Buffer.concat([local, nameBuf, data]))
	const tail = createWriteStream(zipPath, { flags: "r+", start: BIG_OFFSET })
	await new Promise<void>((resolve, reject) => {
		tail.on("error", reject)
		tail.on("close", resolve)
		tail.end(Buffer.concat([central, nameBuf, eocd]))
	})
}

function runScript(root: string, ...args: readonly string[]): string {
	return execFileSync(process.execPath, [SCRIPT_PATH, root, ...args], {
		encoding: "utf8",
	})
}

async function fileTree(root: string): Promise<string[]> {
	const out: string[] = []
	async function walk(dir: string, prefix: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true })
		for (const entry of entries) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name
			if (entry.isDirectory()) {
				await walk(join(dir, entry.name), rel)
			} else {
				out.push(rel)
			}
		}
	}
	await walk(root, "")
	return out.sort()
}

describe("migrate-hoard-to-files.mjs", () => {
	test("migrates archives into data/ preserving subdirectories and dotfile metadata", async () => {
		const root = withTempRoot()
		const resDir = join(root, "versions", "1", "resources", "r1")
		await mkdir(join(resDir, "src"), { recursive: true })
		await writeFile(join(resDir, ".cover.jpg"), "cover-bytes")
		await seedArchive(resDir, [
			["src/a.txt", "alpha"],
			["src/sub/b.txt", "beta"],
		])

		const output = runScript(root)
		expect(output).toContain("2 entries")

		expect(await readFile(join(resDir, "data", "src", "a.txt"), "utf8")).toBe(
			"alpha",
		)
		expect(
			await readFile(join(resDir, "data", "src", "sub", "b.txt"), "utf8"),
		).toBe("beta")
		expect(await readFile(join(resDir, ".cover.jpg"), "utf8")).toBe(
			"cover-bytes",
		)
		await expect(stat(join(resDir, "source.hoard"))).rejects.toThrow()
	})

	test("writes an order manifest preserving the archive's entry order", async () => {
		const root = withTempRoot()
		const resDir = join(root, "versions", "1", "resources", "r1")
		await seedArchive(resDir, [
			["b.png", "beta"],
			["a.png", "alpha"],
			["sub/c.png", "gamma"],
		])

		runScript(root)

		expect(await readFile(join(resDir, "data", ".order"), "utf8")).toBe(
			JSON.stringify(["b.png", "a.png", "sub/c.png"]),
		)
	})

	test("extracts STORED and DEFLATE entries alike", async () => {
		const root = withTempRoot()
		const resDir = join(root, "versions", "1", "resources", "r1")
		await seedArchive(resDir, [["stored.bin", "plain"]], false)
		await seedArchive(
			join(root, "versions", "1", "resources", "r2"),
			[["deflate.bin", "compressed-".repeat(20)]],
			true,
		)

		runScript(root)

		expect(await readFile(join(resDir, "data", "stored.bin"), "utf8")).toBe(
			"plain",
		)
		expect(
			await readFile(
				join(root, "versions", "1", "resources", "r2", "data", "deflate.bin"),
				"utf8",
			),
		).toBe("compressed-".repeat(20))
	})

	test("extracts ZIP64 archives at both the EOCD and entry level", async () => {
		const root = withTempRoot()
		const eocdDir = join(root, "versions", "1", "resources", "r1")
		await seedArchive(eocdDir, [["stored.bin", "plain"]], false, {
			forceZip64Eocd: true,
		})
		const entryDir = join(root, "versions", "1", "resources", "r2")
		await mkdir(entryDir, { recursive: true })
		await writeFile(
			join(entryDir, "source.hoard"),
			await buildEntryZip64Zip([
				["stored.bin", "plain", false],
				["deflate.bin", "compressed-".repeat(20), true],
			]),
		)

		// A tiny budget still passes only if the 64-bit sizes from the
		// ZIP64 extra fields resolve (the 32-bit slots hold 0xffffffff).
		runScript(root, "--max-bytes", "300")

		expect(await readFile(join(eocdDir, "data", "stored.bin"), "utf8")).toBe(
			"plain",
		)
		expect(await readFile(join(entryDir, "data", "stored.bin"), "utf8")).toBe(
			"plain",
		)
		expect(await readFile(join(entryDir, "data", "deflate.bin"), "utf8")).toBe(
			"compressed-".repeat(20),
		)
	})

	test("reads central directories past the 2 GiB offset boundary", async () => {
		const root = withTempRoot()
		const resDir = join(root, "versions", "1", "resources", "r1")
		await mkdir(resDir, { recursive: true })
		await buildBigOffsetZip(join(resDir, "source.hoard"))

		runScript(root)

		expect(await readFile(join(resDir, "data", "a.txt"), "utf8")).toBe("alpha")
	})

	test("resolves case-insensitive name collisions with a -N suffix", async () => {
		const root = withTempRoot()
		const resDir = join(root, "versions", "1", "resources", "r1")
		await seedArchive(resDir, [
			["a.jpg", "one"],
			["A.jpg", "two"],
		])

		runScript(root)

		expect(await readFile(join(resDir, "data", "a.jpg"), "utf8")).toBe("one")
		expect(await readFile(join(resDir, "data", "A-1.jpg"), "utf8")).toBe("two")
		// The manifest carries the final, collision-resolved names.
		expect(await readFile(join(resDir, "data", ".order"), "utf8")).toBe(
			JSON.stringify(["a.jpg", "A-1.jpg"]),
		)
	})

	test("sanitizes unsafe entry names without escaping the folder", async () => {
		const root = withTempRoot()
		const resDir = join(root, "versions", "1", "resources", "r1")
		await mkdir(resDir, { recursive: true })
		await writeFile(
			join(resDir, "source.hoard"),
			buildRawStoredZip([
				["../escape.txt", "escape"],
				["/etc/passwd", "absolute"],
				["bad\u0001name.txt", "control"],
				["CON.txt", "reserved"],
				["dir\\back.txt", "backslash"],
			]),
		)

		runScript(root)

		const tree = await fileTree(join(resDir, "data"))
		expect(tree).toEqual([
			".order",
			"_CON.txt",
			"badname.txt",
			"dir/back.txt",
			"escape.txt",
			"etc/passwd",
		])
		for (const name of tree) expect(name.includes("..")).toBe(false)
	})

	test("writes zero-length STORED entries", async () => {
		const root = withTempRoot()
		const resDir = join(root, "versions", "1", "resources", "r1")
		await mkdir(resDir, { recursive: true })
		await writeFile(
			join(resDir, "source.hoard"),
			buildRawStoredZip([["empty.txt", ""]]),
		)

		const output = runScript(root)
		expect(output).toContain("1 entries")

		expect((await stat(join(resDir, "data", "empty.txt"))).size).toBe(0)
		await expect(stat(join(resDir, "source.hoard"))).rejects.toThrow()
	})

	test("rejects corrupt entry data on CRC mismatch and keeps the archive", async () => {
		const root = withTempRoot()
		const resDir = join(root, "versions", "1", "resources", "r1")
		await mkdir(resDir, { recursive: true })
		const archivePath = join(resDir, "source.hoard")
		await writeFile(archivePath, buildRawStoredZip([["a.txt", "alpha"]], true))

		let failure: unknown
		try {
			runScript(root)
		} catch (err) {
			failure = err
		}
		expect(failure).toBeInstanceOf(Error)
		expect((failure as Error).message).toContain("crc mismatch")
		// Archive still present, nothing extracted.
		expect((await stat(archivePath)).isFile()).toBe(true)
		await expect(stat(join(resDir, "data", "a.txt"))).rejects.toThrow()
	})

	test("rejects over-budget archives and leaves them intact", async () => {
		const root = withTempRoot()
		const resDir = join(root, "versions", "1", "resources", "r1")
		await seedArchive(resDir, [["big.bin", "x".repeat(1024)]])
		const archivePath = join(resDir, "source.hoard")

		expect(() => runScript(root, "--max-bytes", "100")).toThrow()
		// Archive still present, nothing extracted.
		expect((await stat(archivePath)).isFile()).toBe(true)
		await expect(stat(join(resDir, "data", "big.bin"))).rejects.toThrow()
	})

	test("--dry-run changes nothing", async () => {
		const root = withTempRoot()
		const resDir = join(root, "versions", "1", "resources", "r1")
		const archivePath = await seedArchive(resDir, [["a.txt", "alpha"]])

		const output = runScript(root, "--dry-run")
		expect(output).toContain("would")

		expect((await stat(archivePath)).isFile()).toBe(true)
		await expect(stat(join(resDir, "data", "a.txt"))).rejects.toThrow()
	})

	test("is idempotent", async () => {
		const root = withTempRoot()
		const resDir = join(root, "versions", "1", "resources", "r1")
		await seedArchive(resDir, [["a.txt", "alpha"]])

		runScript(root)
		const second = runScript(root)

		expect(second).toContain("skipped")
		expect(await readFile(join(resDir, "data", "a.txt"), "utf8")).toBe("alpha")
	})

	test("migrates trashed resource folders", async () => {
		const root = withTempRoot()
		const trashDir = join(root, "local", "trash", "resources-r9-123")
		await mkdir(trashDir, { recursive: true })
		await writeFile(join(trashDir, ".cover.png"), "trash-cover")
		await seedArchive(trashDir, [["c.txt", "gamma"]])

		runScript(root)

		expect(await readFile(join(trashDir, "data", "c.txt"), "utf8")).toBe(
			"gamma",
		)
		expect(await readFile(join(trashDir, ".cover.png"), "utf8")).toBe(
			"trash-cover",
		)
		await expect(stat(join(trashDir, "source.hoard"))).rejects.toThrow()
	})

	test("resolves file-vs-directory prefix collisions deterministically per CD order", async () => {
		const root = withTempRoot()
		const resDir = join(root, "versions", "1", "resources", "r1")
		await seedArchive(resDir, [
			["x", "file-x"],
			["x/y.txt", "nested-y"],
		])
		// Reversed CD order: the nested entry resolves before its parent file.
		const resDir2 = join(root, "versions", "1", "resources", "r2")
		await seedArchive(resDir2, [
			["x/y.txt", "nested-y"],
			["x", "file-x"],
		])

		runScript(root)

		expect(await fileTree(join(resDir, "data"))).toEqual([
			".order",
			"x",
			"x-1/y.txt",
		])
		expect(await readFile(join(resDir, "data", "x"), "utf8")).toBe("file-x")
		expect(await readFile(join(resDir, "data", "x-1", "y.txt"), "utf8")).toBe(
			"nested-y",
		)
		expect(await fileTree(join(resDir2, "data"))).toEqual([
			".order",
			"x-1",
			"x/y.txt",
		])
		expect(await readFile(join(resDir2, "data", "x-1"), "utf8")).toBe("file-x")
		expect(await readFile(join(resDir2, "data", "x", "y.txt"), "utf8")).toBe(
			"nested-y",
		)
	})

	test("normalizes pre-data layout content into data/", async () => {
		const root = withTempRoot()
		const resDir = join(root, "versions", "1", "resources", "r1")
		await mkdir(join(resDir, "Chapter 1"), { recursive: true })
		await writeFile(join(resDir, "a.txt"), "alpha")
		await writeFile(join(resDir, "Chapter 1", "b.txt"), "beta")
		await writeFile(join(resDir, ".cover.jpg"), "cover-bytes")

		const output = runScript(root)
		expect(output).toContain("normalized")

		expect(await readFile(join(resDir, "data", "a.txt"), "utf8")).toBe("alpha")
		expect(
			await readFile(join(resDir, "data", "Chapter 1", "b.txt"), "utf8"),
		).toBe("beta")
		expect(await readFile(join(resDir, ".cover.jpg"), "utf8")).toBe(
			"cover-bytes",
		)
	})

	test("merges legacy root content into an existing data/ directory", async () => {
		const root = withTempRoot()
		const resDir = join(root, "versions", "1", "resources", "r1")
		await mkdir(join(resDir, "data"), { recursive: true })
		await writeFile(join(resDir, "data", "existing.txt"), "kept")
		await writeFile(join(resDir, "legacy.txt"), "moved")

		runScript(root)

		expect(await readFile(join(resDir, "data", "existing.txt"), "utf8")).toBe(
			"kept",
		)
		expect(await readFile(join(resDir, "data", "legacy.txt"), "utf8")).toBe(
			"moved",
		)
		await expect(stat(join(resDir, "legacy.txt"))).rejects.toThrow()
	})
})
