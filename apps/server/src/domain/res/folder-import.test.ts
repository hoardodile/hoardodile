import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
	assertInsideGuard,
	browseDirectory,
	cleanupOldExtractions,
	cleanupTmpDir,
} from "./folder-import.ts"

describe("browseDirectory", () => {
	let rootDir: string

	beforeEach(() => {
		rootDir = mkdtempSync(join(tmpdir(), "browse-test-"))
		// Create a directory structure:
		//   rootDir/
		//     sub-a/
		//     sub-b/
		//     .hidden/
		//     file1.txt
		//     file2.png
		mkdirSync(join(rootDir, "sub-a"))
		mkdirSync(join(rootDir, "sub-b"))
		mkdirSync(join(rootDir, ".hidden"))
		writeFileSync(join(rootDir, "file1.txt"), "hello")
		writeFileSync(join(rootDir, "file2.png"), "img")
	})

	afterEach(() => {
		rmSync(rootDir, { recursive: true, force: true })
	})

	test("lists immediate children, skipping dotfiles", async () => {
		const entries = await browseDirectory(rootDir, undefined, rootDir)
		const names = entries.map((e) => e.name)
		expect(names).toEqual(["file1.txt", "file2.png", "sub-a", "sub-b"])
	})

	test("distinguishes dir and file kinds", async () => {
		const entries = await browseDirectory(rootDir, undefined, rootDir)
		const dirEntries = entries.filter((e) => e.kind === "dir")
		const fileEntries = entries.filter((e) => e.kind === "file")
		expect(dirEntries.map((e) => e.name)).toEqual(["sub-a", "sub-b"])
		expect(fileEntries.map((e) => e.name)).toEqual(["file1.txt", "file2.png"])
	})

	test("navigates into subdirectory via subPath", async () => {
		writeFileSync(join(rootDir, "sub-a", "nested.txt"), "nested")
		const entries = await browseDirectory(rootDir, "sub-a", rootDir)
		expect(entries).toEqual([{ name: "nested.txt", kind: "file" }])
	})

	test("returns empty array for empty directory", async () => {
		const entries = await browseDirectory(
			join(rootDir, "sub-a"),
			undefined,
			rootDir,
		)
		expect(entries).toEqual([])
	})

	test("returns empty array for non-existent directory", async () => {
		const entries = await browseDirectory(
			join(rootDir, "no-such"),
			undefined,
			rootDir,
		)
		expect(entries).toEqual([])
	})

	test("rejects path traversal outside guard root", async () => {
		await expect(browseDirectory(rootDir, "..", rootDir)).rejects.toThrow()
	})
})

describe("assertInsideGuard", () => {
	test("allows paths within guard root", () => {
		const result = assertInsideGuard("/root", "sub/dir", "/root")
		expect(result).toBe(resolve("/root/sub/dir"))
	})

	test("allows exact match with guard root", () => {
		const result = assertInsideGuard("/root", undefined, "/root")
		expect(result).toBe(resolve("/root"))
	})

	test("rejects paths escaping guard root", () => {
		expect(() => assertInsideGuard("/root", "../escape", "/root")).toThrow()
	})

	test("rejects when root itself is outside guard", () => {
		expect(() => assertInsideGuard("/other", undefined, "/root")).toThrow()
	})
})

describe("cleanupOldExtractions", () => {
	let tmpBase: string

	beforeEach(() => {
		tmpBase = mkdtempSync(join(tmpdir(), "cleanup-test-"))
	})

	afterEach(() => {
		rmSync(tmpBase, { recursive: true, force: true })
	})

	test("removes old extract-* directories", async () => {
		const oldDir = join(tmpBase, "extract-old")
		mkdirSync(oldDir)
		writeFileSync(join(oldDir, "data.txt"), "old")

		// Set mtime to 48 hours ago
		const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000)
		const { utimes } = await import("node:fs/promises")
		await utimes(oldDir, oldTime, oldTime)

		await cleanupOldExtractions(tmpBase, 24 * 60 * 60 * 1000)
		expect(existsSync(oldDir)).toBe(false)
	})

	test("keeps recent extract-* directories", async () => {
		const recentDir = join(tmpBase, "extract-recent")
		mkdirSync(recentDir)
		writeFileSync(join(recentDir, "data.txt"), "recent")

		await cleanupOldExtractions(tmpBase, 24 * 60 * 60 * 1000)
		expect(existsSync(recentDir)).toBe(true)
	})

	test("ignores non-extract directories", async () => {
		const otherDir = join(tmpBase, "other-stuff")
		mkdirSync(otherDir)

		await cleanupOldExtractions(tmpBase, 24 * 60 * 60 * 1000)
		expect(existsSync(otherDir)).toBe(true)
	})

	test("handles empty tmp directory", async () => {
		await expect(
			cleanupOldExtractions(tmpBase, 24 * 60 * 60 * 1000),
		).resolves.toBeUndefined()
	})
})

describe("cleanupTmpDir", () => {
	let tmpBase: string

	beforeEach(() => {
		tmpBase = mkdtempSync(join(tmpdir(), "tmp-cleanup-test-"))
	})

	afterEach(() => {
		rmSync(tmpBase, { recursive: true, force: true })
	})

	test("removes all directories under tmpBase", async () => {
		const dir1 = join(tmpBase, "extract-abc")
		const dir2 = join(tmpBase, "550e8400-e29b-41d4-a716-446655440000")
		mkdirSync(dir1)
		mkdirSync(dir2)
		writeFileSync(join(dir1, "a.txt"), "a")
		writeFileSync(join(dir2, "b.txt"), "b")

		await cleanupTmpDir(tmpBase)
		expect(existsSync(dir1)).toBe(false)
		expect(existsSync(dir2)).toBe(false)
	})

	test("removes all files directly in tmpBase", async () => {
		writeFileSync(join(tmpBase, "tempfile"), "data")

		await cleanupTmpDir(tmpBase)
		expect(existsSync(join(tmpBase, "tempfile"))).toBe(false)
	})

	test("handles empty tmpBase", async () => {
		await expect(cleanupTmpDir(tmpBase)).resolves.toBeUndefined()
	})
})
