import {
	link,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { publishVersion } from "./publish-version.ts"
import { currentVersion, ensureBootstrapVersion } from "./version.ts"

const roots: string[] = []
afterEach(async () => {
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true })
})
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "publish-archive-"))
	roots.push(root)
	ensureBootstrapVersion(root)
	return root
}

it("copies the entire plugin tree into independent files before freezing the old database", async () => {
	const root = await fixture(),
		source = join(root, "versions", "1", "plugins", "fixture")
	await mkdir(join(source, "vault"), { recursive: true })
	await writeFile(join(source, "main.js"), "first code")
	await writeFile(join(source, "vault", "data"), "first asset")
	await publishVersion({
		root,
		snapshot: async (path) => {
			await writeFile(path, "database")
		},
	})
	const next = join(root, "versions", "2", "plugins", "fixture")
	expect((await stat(join(source, "vault", "data"))).ino).not.toBe(
		(await stat(join(next, "vault", "data"))).ino,
	)
	await writeFile(join(next, "vault", "data"), "second asset")
	expect(await readFile(join(source, "vault", "data"), "utf8")).toBe(
		"first asset",
	)
	expect(
		await readFile(join(root, "versions", "1", "app.sqlite"), "utf8"),
	).toBe("database")
})

it("keeps the active generation when snapshot preparation fails", async () => {
	const root = await fixture()
	await expect(
		publishVersion({
			root,
			snapshot: async () => {
				throw new Error("snapshot failed")
			},
		}),
	).rejects.toThrow("snapshot failed")
	expect(currentVersion(root)).toBe(1)
	await expect(stat(join(root, "versions", "2"))).rejects.toMatchObject({
		code: "ENOENT",
	})
})

it("rejects shared hard-linked plugin storage before publication", async () => {
	const root = await fixture(),
		plugins = join(root, "versions", "1", "plugins")
	await mkdir(plugins, { recursive: true })
	await writeFile(join(plugins, "a"), "shared")
	await link(join(plugins, "a"), join(plugins, "b"))
	await expect(
		publishVersion({ root, snapshot: async () => {} }),
	).rejects.toThrow("independent files")
	expect(currentVersion(root)).toBe(1)
})
