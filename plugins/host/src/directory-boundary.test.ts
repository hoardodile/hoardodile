import {
	link,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buffer } from "node:stream/consumers"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createPluginResourceAPI } from "./api.ts"
import { createDirectoryResourceAPI } from "./directory-api.ts"
import { createDirectoryContainer } from "./directory-container.ts"
import { createNestedAwareContainer } from "./nested-view.ts"

let root: string, data: string, outside: string
const directoryLink = process.platform === "win32" ? "junction" : "dir"

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "resource-read-boundary-"))
	data = join(root, "data")
	outside = join(root, "outside")
	await mkdir(data)
	await mkdir(outside)
	await writeFile(join(data, "inside.txt"), "inside")
	await writeFile(join(outside, "secret.txt"), "outside")
})
afterEach(async () => {
	await rm(root, { recursive: true, force: true })
})

describe("resource directory boundaries", () => {
	test("rejects an outside junction through every read and metadata capability", async () => {
		await symlink(outside, join(data, "linked"), directoryLink)
		const view = createDirectoryContainer(data)
		const path = "linked/secret.txt"
		for (const read of [
			() => view.readEntry(path),
			() => view.readEntrySlice(path, 0, 3),
			() => view.openEntryStream(path),
			() => view.resolveByteRange(path),
			() => view.resolveSeekablePath!(path),
		])
			await expect(read()).rejects.toThrow("Resource path is unsafe")
		expect(await view.listEntries()).toEqual(["inside.txt"])
		const api = createDirectoryResourceAPI(data)
		await expect(api.readFile(path)).rejects.toThrow("Resource path is unsafe")
		await expect(api.readFile(path, { start: 0, end: 3 })).rejects.toThrow(
			"Resource path is unsafe",
		)
		await expect(api.statFile(path)).rejects.toThrow("Resource path is unsafe")
	})

	test("rejects nested junctions and a linked data root", async () => {
		await mkdir(join(data, "sub"))
		await symlink(outside, join(data, "sub", "linked"), directoryLink)
		await expect(
			createDirectoryContainer(data).readEntry("sub/linked/secret.txt"),
		).rejects.toThrow("Resource path is unsafe")
		const alias = join(root, "linked-data")
		await symlink(outside, alias, directoryLink)
		await expect(createDirectoryContainer(alias).listEntries()).rejects.toThrow(
			"Resource path is unsafe",
		)
		await expect(
			createDirectoryContainer(alias).readEntry("secret.txt"),
		).rejects.toThrow("Resource path is unsafe")
	})

	test("checks resource ancestors below a supplied storage boundary", async () => {
		const storage = join(root, "library")
		await mkdir(join(storage, "versions", "1", "resources"), {
			recursive: true,
		})
		await mkdir(join(outside, "data"))
		await writeFile(join(outside, "data", "secret.txt"), "outside")
		const resource = join(storage, "versions", "1", "resources", "resource")
		await symlink(outside, resource, directoryLink)
		const view = createDirectoryContainer(join(resource, "data"), {
			boundaryRoot: storage,
		})
		await expect(view.readEntry("secret.txt")).rejects.toThrow(
			"Resource path is unsafe",
		)
		await expect(view.resolveSeekablePath!("secret.txt")).rejects.toThrow(
			"Resource path is unsafe",
		)
	})

	test("permits a trusted storage-root alias and returns a canonical native path", async () => {
		const alias = join(root, "library-alias")
		await symlink(root, alias, directoryLink)
		const view = createDirectoryContainer(join(alias, "data"), {
			boundaryRoot: alias,
		})
		expect((await view.readEntry("inside.txt")).toString()).toBe("inside")
		expect(await view.resolveSeekablePath!("inside.txt")).toBe(
			await realpath(join(data, "inside.txt")),
		)
	})

	test("rechecks paths after earlier valid reads and rejects shared files", async () => {
		const view = createDirectoryContainer(data)
		expect((await view.readEntry("inside.txt")).toString()).toBe("inside")
		await rm(join(data, "inside.txt"))
		await link(join(outside, "secret.txt"), join(data, "inside.txt"))
		await expect(view.readEntry("inside.txt")).rejects.toThrow(
			"Resource path is unsafe",
		)
		await expect(view.resolveByteRange("inside.txt")).rejects.toThrow(
			"Resource path is unsafe",
		)
	})

	test("rejects file symlinks when supported by the platform", async ({
		skip,
	}) => {
		try {
			await symlink(
				join(outside, "secret.txt"),
				join(data, "linked.txt"),
				"file",
			)
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "EPERM") {
				skip(
					"File symlinks require Windows developer mode or an elevated token",
				)
				return
			}
			throw error
		}
		await expect(
			createDirectoryContainer(data).readEntry("linked.txt"),
		).rejects.toThrow("Resource path is unsafe")
	})

	test("does not follow a linked order manifest", async () => {
		await writeFile(join(outside, "order.json"), '["inside.txt"]')
		await link(join(outside, "order.json"), join(data, ".order"))
		await expect(createDirectoryContainer(data).listEntries()).rejects.toThrow(
			"Resource path is unsafe",
		)
	})

	test("streams from the verified handle when the pathname is replaced later", async () => {
		const view = createDirectoryContainer(data)
		const opened = await view.openEntryStream("inside.txt")
		try {
			await rename(join(data, "inside.txt"), join(data, "original.txt"))
			await link(join(outside, "secret.txt"), join(data, "inside.txt"))
			expect((await buffer(opened.stream)).toString()).toBe("inside")
			await expect(view.readEntry("inside.txt")).rejects.toThrow(
				"Resource path is unsafe",
			)
		} finally {
			opened.stream.destroy()
		}
	})

	test("rejects a replaced boundary and preserves ordinary missing-file behavior", async () => {
		const view = createDirectoryContainer(data)
		expect(await view.resolveByteRange("missing.txt")).toBeUndefined()
		expect(await view.resolveSeekablePath!("missing.txt")).toBeUndefined()
		await rename(data, join(root, "old-data"))
		await mkdir(data)
		await writeFile(join(data, "inside.txt"), "replacement")
		await expect(view.readEntry("inside.txt")).rejects.toThrow(
			"Resource path is unsafe",
		)
		expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("outside")
	})
})

describe("materialized resource boundaries", () => {
	test("rejects redirected cache ancestors for reads and extraction reuse", async () => {
		await writeFile(join(data, "book.cb7"), "opaque")
		const directory = join(outside, "archives", "book.cb7")
		await mkdir(directory, { recursive: true })
		await writeFile(join(directory, "secret.txt"), "outside")
		await writeFile(
			join(directory, "index.json"),
			JSON.stringify({
				v: 1,
				archiveName: "book.cb7",
				entries: [{ path: "secret.txt", sizeBytes: 7, kind: "other" }],
			}),
		)
		await symlink(outside, join(root, "cache"), directoryLink)
		const cache = join(root, "cache", "archives")
		const base = createDirectoryContainer(data)
		const view = createNestedAwareContainer(base, undefined, undefined, {
			directory: cache,
			boundaryRoot: root,
		})
		await expect(view.readEntry("book.cb7!secret.txt")).rejects.toThrow()
		const api = createPluginResourceAPI({
			view: base,
			extractCacheDir: cache,
			extractCacheBoundaryRoot: root,
		})
		await expect(api.extractArchive("book.cb7")).rejects.toThrow(
			"Resource path is unsafe",
		)
	})

	test("revalidates a cached entry after its manifest has already been read", async () => {
		await writeFile(join(data, "book.cb7"), "opaque")
		const cache = join(root, "cache"),
			contents = join(cache, "book.cb7")
		await mkdir(contents, { recursive: true })
		await writeFile(join(contents, "page.txt"), "cached")
		await writeFile(
			join(contents, "index.json"),
			JSON.stringify({
				v: 1,
				archiveName: "book.cb7",
				entries: [{ path: "page.txt", sizeBytes: 6, kind: "other" }],
			}),
		)
		const view = createNestedAwareContainer(
			createDirectoryContainer(data),
			undefined,
			undefined,
			cache,
		)
		expect((await view.readEntry("book.cb7!page.txt")).toString()).toBe(
			"cached",
		)
		await rm(join(contents, "page.txt"))
		await link(join(outside, "secret.txt"), join(contents, "page.txt"))
		await expect(view.readEntry("book.cb7!page.txt")).rejects.toThrow(
			"Resource path is unsafe",
		)
		await expect(
			view.readEntrySlice("book.cb7!page.txt", 0, 2),
		).rejects.toThrow("Resource path is unsafe")
		await expect(view.openEntryStream("book.cb7!page.txt")).rejects.toThrow(
			"Resource path is unsafe",
		)
		await expect(
			view.resolveSeekablePath!("book.cb7!page.txt"),
		).rejects.toThrow("Resource path is unsafe")
	})

	test("does not read a completion manifest through an outside junction", async () => {
		await writeFile(join(data, "book.cb7"), "opaque")
		await writeFile(
			join(outside, "index.json"),
			JSON.stringify({
				v: 1,
				archiveName: "book.cb7",
				entries: [{ path: "secret.txt", sizeBytes: 7, kind: "other" }],
			}),
		)
		const cache = join(root, "cache")
		await mkdir(cache)
		await symlink(outside, join(cache, "book.cb7"), directoryLink)
		const view = createNestedAwareContainer(
			createDirectoryContainer(data),
			undefined,
			undefined,
			cache,
		)
		await expect(view.readEntry("book.cb7!secret.txt")).rejects.toThrow()
		expect(
			await view.resolveSeekablePath!("book.cb7!secret.txt"),
		).toBeUndefined()
	})
})
