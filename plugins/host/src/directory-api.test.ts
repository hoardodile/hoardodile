import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
	createDirectoryResourceAPI,
	resolveSafeImportPath,
} from "./directory-api.ts"

describe("createDirectoryResourceAPI", () => {
	let rootDir: string

	beforeEach(() => {
		rootDir = mkdtempSync(join(tmpdir(), "directory-api-test-"))
		mkdirSync(join(rootDir, "sub"))
		writeFileSync(join(rootDir, "inside.txt"), "inside")
		writeFileSync(join(rootDir, "sub", "nested.txt"), "nested")
	})

	afterEach(() => {
		rmSync(rootDir, { recursive: true, force: true })
	})

	test("readFile allows paths inside the directory", async () => {
		const api = createDirectoryResourceAPI(rootDir)
		const data = await api.readFile("inside.txt")
		expect(new TextDecoder().decode(data)).toBe("inside")
	})

	test("readFile rejects parent directory traversal", async () => {
		const api = createDirectoryResourceAPI(rootDir)
		await expect(api.readFile("../outside.txt")).rejects.toThrow(
			"escapes import directory",
		)
	})

	test("readFile rejects nested traversal", async () => {
		const api = createDirectoryResourceAPI(rootDir)
		await expect(api.readFile("sub/../../outside.txt")).rejects.toThrow(
			"escapes import directory",
		)
	})

	test("readFile rejects absolute paths", async () => {
		const api = createDirectoryResourceAPI(rootDir)
		await expect(api.readFile("/etc/passwd")).rejects.toThrow(
			"absolute paths are not allowed",
		)
	})

	test("readFile rejects empty paths", async () => {
		const api = createDirectoryResourceAPI(rootDir)
		await expect(api.readFile("")).rejects.toThrow("path is empty")
	})

	test("readFile rejects null bytes", async () => {
		const api = createDirectoryResourceAPI(rootDir)
		await expect(api.readFile("inside.txt\0extra")).rejects.toThrow("null byte")
	})

	test("statFile validates paths and reports real sizes", async () => {
		const api = createDirectoryResourceAPI(rootDir)
		await expect(api.statFile("../outside.txt")).rejects.toThrow(
			"escapes import directory",
		)
		expect(await api.statFile("inside.txt")).toEqual({ sizeBytes: 6 })
	})

	test("sniffing works without probe backends", async () => {
		const api = createDirectoryResourceAPI(rootDir)
		// Identification only reads bytes, so the directory API answers it
		// in full — decoding is what has no backend here.
		expect(await api.sniff("inside.txt")).toEqual({
			mime: "text/plain",
			ext: ".txt",
			kind: "other",
			source: "extension",
		})
		expect(await api.probe("inside.txt")).toEqual({
			kind: "other",
			mime: "text/plain",
		})
	})

	test("listFileNames stays within the directory", async () => {
		const api = createDirectoryResourceAPI(rootDir)
		const files = await api.listFileNames()
		expect([...files].sort()).toEqual(["inside.txt", "sub/nested.txt"])
	})
})

describe("createDirectoryResourceAPI listFileNames", () => {
	let rootDir: string

	beforeEach(() => {
		rootDir = mkdtempSync(join(tmpdir(), "directory-api-list-"))
		writeFileSync(join(rootDir, "page10.txt"), "")
		writeFileSync(join(rootDir, "page2.txt"), "")
		writeFileSync(join(rootDir, "page1.txt"), "")
		writeFileSync(join(rootDir, ".hidden"), "")
		writeFileSync(join(rootDir, "cover.uploading-abc123"), "")
		mkdirSync(join(rootDir, ".hiddendir"))
		writeFileSync(join(rootDir, ".hiddendir", "secret.txt"), "")
	})

	afterEach(() => {
		rmSync(rootDir, { recursive: true, force: true })
	})

	test("skips dotfiles and .uploading- entries", async () => {
		const api = createDirectoryResourceAPI(rootDir)
		const files = await api.listFileNames()
		expect(files.every((f) => !f.includes(".hidden"))).toBe(true)
		expect(files.some((f) => f.includes(".uploading-"))).toBe(false)
	})

	test("sorts with localeCompare numeric ordering", async () => {
		const api = createDirectoryResourceAPI(rootDir)
		expect(await api.listFileNames()).toEqual([
			"page1.txt",
			"page2.txt",
			"page10.txt",
		])
	})
})

describe("createDirectoryResourceAPI order manifest", () => {
	let rootDir: string

	beforeEach(() => {
		rootDir = mkdtempSync(join(tmpdir(), "directory-api-order-"))
		writeFileSync(join(rootDir, "b.txt"), "")
		writeFileSync(join(rootDir, "a.txt"), "")
		writeFileSync(join(rootDir, "c.txt"), "")
	})

	afterEach(() => {
		rmSync(rootDir, { recursive: true, force: true })
	})

	test("honors a valid .order manifest over the natural sort", async () => {
		writeFileSync(
			join(rootDir, ".order"),
			JSON.stringify(["c.txt", "a.txt", "b.txt"]),
		)
		const api = createDirectoryResourceAPI(rootDir)
		expect(await api.listFileNames()).toEqual(["c.txt", "a.txt", "b.txt"])
	})

	test("appends entries the manifest does not mention, naturally sorted", async () => {
		writeFileSync(join(rootDir, ".order"), JSON.stringify(["c.txt"]))
		const api = createDirectoryResourceAPI(rootDir)
		expect(await api.listFileNames()).toEqual(["c.txt", "a.txt", "b.txt"])
	})

	test("ignores a manifest whose entries do not resolve", async () => {
		writeFileSync(
			join(rootDir, ".order"),
			JSON.stringify(["gone.txt", "b.txt"]),
		)
		const api = createDirectoryResourceAPI(rootDir)
		expect(await api.listFileNames()).toEqual(["a.txt", "b.txt", "c.txt"])
	})

	test("ignores a malformed stray .order in an arbitrary import dir", async () => {
		writeFileSync(join(rootDir, ".order"), "not json")
		const api = createDirectoryResourceAPI(rootDir)
		expect(await api.listFileNames()).toEqual(["a.txt", "b.txt", "c.txt"])
	})
})

describe("createDirectoryResourceAPI ranged reads", () => {
	let rootDir: string

	beforeEach(() => {
		rootDir = mkdtempSync(join(tmpdir(), "directory-api-range-"))
		writeFileSync(join(rootDir, "data.bin"), Buffer.from([1, 2, 3, 4, 250]))
	})

	afterEach(() => {
		rmSync(rootDir, { recursive: true, force: true })
	})

	test("range returns the requested slice", async () => {
		const api = createDirectoryResourceAPI(rootDir)
		expect([...(await api.readFile("data.bin", { start: 1, end: 4 }))]).toEqual(
			[2, 3, 4],
		)
	})

	test("end defaults to file size and clamps", async () => {
		const api = createDirectoryResourceAPI(rootDir)
		expect([...(await api.readFile("data.bin", { start: 3 }))]).toEqual([
			4, 250,
		])
		expect([
			...(await api.readFile("data.bin", { start: 0, end: 10_000 })),
		]).toEqual([1, 2, 3, 4, 250])
	})

	test("start past the end returns empty", async () => {
		const api = createDirectoryResourceAPI(rootDir)
		expect(
			(await api.readFile("data.bin", { start: 100, end: 200 })).byteLength,
		).toBe(0)
	})

	test("full reads above the byte cap are rejected with guidance", async () => {
		const api = createDirectoryResourceAPI(rootDir, { maxReadFileBytes: 4 })
		await expect(api.readFile("data.bin")).rejects.toThrow(/byte range/)
	})

	test("ranged reads above the byte cap are rejected too", async () => {
		const api = createDirectoryResourceAPI(rootDir, { maxReadFileBytes: 3 })
		await expect(
			api.readFile("data.bin", { start: 0, end: 5 }),
		).rejects.toThrow(/byte range/)
		await expect(
			api.readFile("data.bin", { start: 0, end: 3 }),
		).resolves.toHaveLength(3)
	})
})

describe("resolveSafeImportPath", () => {
	test("resolves a valid relative path against the directory", () => {
		const resolved = resolveSafeImportPath("root", "a/b.txt")
		expect(resolved.endsWith(join("root", "a", "b.txt"))).toBe(true)
	})
})
