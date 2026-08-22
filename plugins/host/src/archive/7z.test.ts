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
import { describe, expect, it } from "vitest"
import {
	extractSevenZipInto,
	listSevenZipEntries,
	resolveSevenZipPath,
} from "./7z.ts"
import {
	createArchiveExtractor,
	type ExtractArchiveDeps,
} from "./extract-archive.ts"
import type { OuterEntrySource } from "./nested-entry.ts"

const bin = resolveSevenZipPath()
const sevenZipAvailable = bin !== undefined

function makeSevenZip(
	dir: string,
	files: Record<string, string>,
	opts: string[] = [],
) {
	const payload = join(dir, "payload")
	mkdirSync(payload, { recursive: true })
	for (const [name, content] of Object.entries(files)) {
		const filePath = join(payload, name)
		mkdirSync(dirname(filePath), { recursive: true })
		writeFileSync(filePath, content)
	}
	const archivePath = join(dir, "fixture.7z")
	execFileSync(bin!, ["a", "-t7z", ...opts, archivePath, "."], {
		cwd: payload,
		stdio: "ignore",
	})
	return archivePath
}

function entrySource(archivePath: string): OuterEntrySource {
	const bytes = readFileSync(archivePath)
	return {
		sizeOf: async () => bytes.length,
		readSlice: async (_rel, start, end) => bytes.subarray(start, end),
	}
}

function makeExtractor(
	archivePath: string,
	overrides: Partial<ExtractArchiveDeps> = {},
) {
	const root = mkdtempSync(join(tmpdir(), "7z-extract-"))
	return {
		root,
		extractor: createArchiveExtractor({
			outer: entrySource(archivePath),
			cacheDir: join(root, "cache"),
			maxBytes: 10 * 1024 * 1024,
			maxEntries: 100,
			...overrides,
		}),
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	}
}

describe.skipIf(!sevenZipAvailable)("7z binary capabilities", () => {
	it("supports RAR5 extraction", () => {
		// The shipped binary must include the full codecs (7za.exe does
		// not — the package now ships 7z.exe+7z.dll on Windows and 7zz
		// on POSIX, both with RAR support).
		const info = execFileSync(bin!, ["i"], { encoding: "utf8" })
		expect(info).toMatch(/\bRar5\b/)
	})
})

describe.skipIf(!sevenZipAvailable)("7z listing", () => {
	it("parses entries from a real .7z archive", async () => {
		const dir = mkdtempSync(join(tmpdir(), "7z-list-"))
		try {
			const archivePath = makeSevenZip(dir, {
				"a/b.txt": "hello",
				"c.bin": "x".repeat(4096),
			})
			const entries = await listSevenZipEntries(archivePath)
			const files = entries.filter((e) => !e.folder)
			expect(files.map((e) => e.name).sort()).toEqual(["a/b.txt", "c.bin"])
			expect(files.find((e) => e.name === "c.bin")?.sizeBytes).toBe(4096)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe.skipIf(!sevenZipAvailable)("7z rar fixture", () => {
	const FIXTURE = join(
		import.meta.dirname,
		"../../testdata/rar5-multiple-files.rar",
	)

	it("lists the vendored rar5 sample", async () => {
		const entries = await listSevenZipEntries(FIXTURE)
		const files = entries.filter((e) => !e.folder)
		expect(files.map((e) => e.name).sort()).toEqual([
			"test1.bin",
			"test2.bin",
			"test3.bin",
			"test4.bin",
		])
		for (const entry of files) expect(entry.sizeBytes).toBe(4096)
	})

	it("extracts the vendored rar5 sample", async () => {
		const dir = mkdtempSync(join(tmpdir(), "7z-rar-x-"))
		try {
			await extractSevenZipInto(FIXTURE, join(dir, "out"))
			expect(readFileSync(join(dir, "out", "test1.bin")).length).toBe(4096)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe.skipIf(!sevenZipAvailable)("7z extraction", () => {
	it("extracts an archive into a directory", async () => {
		const dir = mkdtempSync(join(tmpdir(), "7z-x-"))
		try {
			const archivePath = makeSevenZip(dir, { "a/b.txt": "hello" })
			const out = join(dir, "out")
			await extractSevenZipInto(archivePath, out)
			expect(readFileSync(join(out, "a", "b.txt"), "utf8")).toBe("hello")
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe.skipIf(!sevenZipAvailable)("extractArchive 7z dispatch", () => {
	it("materializes a .7z container with an idempotent manifest", async () => {
		const dir = mkdtempSync(join(tmpdir(), "7z-api-"))
		try {
			const archivePath = makeSevenZip(dir, { "img.txt": "payload" })
			const { extractor, root, cleanup } = makeExtractor(archivePath)
			try {
				const first = await extractor.extract("fixture.7z")
				expect(first.entries.map((e) => e.path)).toEqual(["img.txt"])
				expect(
					readFileSync(join(root, "cache", "fixture.7z", "img.txt"), "utf8"),
				).toBe("payload")
				// second run reuses the manifest without re-extracting
				const second = await extractor.extract("fixture.7z")
				expect(second.entries).toEqual(first.entries)
			} finally {
				cleanup()
			}
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("rejects archives over the byte budget", async () => {
		const dir = mkdtempSync(join(tmpdir(), "7z-budget-"))
		try {
			const archivePath = makeSevenZip(dir, { "big.bin": "y".repeat(2048) })
			const { extractor, cleanup } = makeExtractor(archivePath, {
				maxBytes: 1024,
			})
			try {
				await expect(extractor.extract("fixture.7z")).rejects.toThrow(
					/exceeding the limit/,
				)
			} finally {
				cleanup()
			}
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("rejects password-protected archives", async () => {
		const dir = mkdtempSync(join(tmpdir(), "7z-enc-"))
		try {
			const archivePath = makeSevenZip(dir, { "secret.txt": "top" }, [
				"-psecret",
			])
			const { extractor, cleanup } = makeExtractor(archivePath)
			try {
				await expect(extractor.extract("fixture.7z")).rejects.toThrow(
					/password-protected/,
				)
			} finally {
				cleanup()
			}
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("lists 7z archives but does not address them as nested containers", async () => {
		const dir = mkdtempSync(join(tmpdir(), "7z-nested-"))
		try {
			const archivePath = makeSevenZip(dir, { "inner.txt": "x" })
			const { extractor, cleanup } = makeExtractor(archivePath)
			try {
				// The extractor's list answers for any 7-Zip-able format
				// (metadata-only); only the *resolver* (virtual
				// `outer!inner` addressing) stays zip-only.
				const listing = await extractor.list("fixture.7z")
				expect(listing?.map((e) => e.name)).toEqual(["inner.txt"])
			} finally {
				cleanup()
			}
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
