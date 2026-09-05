import { randomUUID } from "node:crypto"
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
	createStoragePaths,
	ensureBootstrapVersion,
	writeVersioned,
} from "@hoardodile/host/hoard"
import { loadEnv } from "src/config/env.ts"
import {
	type BuiltServer,
	buildServer,
	reloadStorageContext,
} from "src/server.ts"
import { afterEach, expect, it } from "vitest"
import {
	installPluginTransaction,
	recoverPluginInstallations,
} from "./install-transaction.ts"

const roots: string[] = []
let server: BuiltServer | undefined
afterEach(async () => {
	await server?.close()
	server = undefined
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true })
})

async function writePlugin(
	directory: string,
	id: string,
	version: string,
	label: string,
) {
	await mkdir(directory, { recursive: true })
	await writeFile(
		join(directory, "manifest.json"),
		JSON.stringify({
			id,
			version,
			name: "Historical plugin",
			description: "Historical plugin integration fixture",
			permissions: { sourceMeta: true },
		}),
	)
	await writeFile(
		join(directory, "main.js"),
		`export default {detect:async()=>({ok:true}),sourceMeta:async()=>({label:${JSON.stringify(label)}})}`,
	)
	await writeFile(
		join(directory, "render.js"),
		`document.body.textContent=${JSON.stringify(label)}`,
	)
	await writeFile(
		join(directory, "index.html"),
		`<html><body>${label}</body></html>`,
	)
}

it("keeps independent plugin and vault copies and reloads the selected archive's assets", async () => {
	const root = await mkdtemp(join(tmpdir(), "hd-plugin-history-"))
	roots.push(root)
	ensureBootstrapVersion(root)
	const id = randomUUID()
	const first = join(root, "versions", "1", "plugins", id)
	await writePlugin(first, id, "1.0.0", "first")
	await mkdir(join(first, "vault"))
	await writeFile(join(first, "vault", "asset.txt"), "first vault")
	server = await buildServer({
		env: loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
			DISABLE_DEV_PLUGINS: "true",
		}),
	})
	await server.app.ready()
	const app = server.app
	const before = app.pluginService.getAssetVersion(id)
	await app.versionService.create(
		{},
		{ afterPublish: () => reloadStorageContext(app).then(() => undefined) },
	)
	const second = join(root, "versions", "2", "plugins", id)
	expect((await stat(join(first, "main.js"))).ino).not.toBe(
		(await stat(join(second, "main.js"))).ino,
	)
	await writeVersioned(app.paths, false, async () => {
		await writePlugin(second, id, "2.0.0", "second")
		await writeFile(join(second, "vault", "asset.txt"), "second vault")
	})
	await app.pluginService.rescan()
	expect(app.pluginLoader.getRegistry().getById(id)?.manifest.version).toBe(
		"2.0.0",
	)
	expect(app.pluginService.getAssetVersion(id)).not.toBe(before)
	app.versionService.switchTo(1)
	await reloadStorageContext(app)
	expect(app.pluginLoader.getRegistry().getById(id)?.manifest.version).toBe(
		"1.0.0",
	)
	expect(app.pluginLoader.getRegistry().getById(id)?.diskPath).toBe(
		resolve(first),
	)
	expect(app.pluginService.getAssetVersion(id)).toBe(before)
	expect(await readFile(join(first, "vault", "asset.txt"), "utf8")).toBe(
		"first vault",
	)
	expect(await readFile(join(second, "vault", "asset.txt"), "utf8")).toBe(
		"second vault",
	)
	const builtin = app.pluginLoader.getRegistry().getBuiltin()
	expect(builtin?.diskPath).toContain(join("versions", "1", "plugins"))
}, 30_000)

it("preserves the vault during installation and replays a prepared publication after interruption", async () => {
	const root = await mkdtemp(join(tmpdir(), "hd-plugin-install-"))
	roots.push(root)
	ensureBootstrapVersion(root)
	const paths = createStoragePaths({ root })
	const id = randomUUID()
	const target = join(paths.latest.plugins(), id)
	await writePlugin(target, id, "1.0.0", "old")
	await mkdir(join(target, "vault"))
	await writeFile(join(target, "vault", "data.bin"), "preserve")
	const staged = join(root, "staged")
	await writePlugin(staged, id, "2.0.0", "new")
	await writeVersioned(paths, false, () =>
		installPluginTransaction({ paths, pluginId: id, staging: staged }),
	)
	expect(await readFile(join(target, "vault", "data.bin"), "utf8")).toBe(
		"preserve",
	)
	const work = join(paths.local.root, "plugin-transactions", randomUUID())
	await mkdir(work, { recursive: true })
	await rename(target, join(work, "previous"))
	await writePlugin(join(work, "next"), id, "3.0.0", "recovered")
	await mkdir(join(work, "next", "vault"))
	await writeFile(join(work, "next", "vault", "data.bin"), "preserve")
	await writeFile(
		join(work, "pending.json"),
		JSON.stringify({ version: 1, pluginId: id }),
	)
	await recoverPluginInstallations(paths)
	expect(
		JSON.parse(await readFile(join(target, "manifest.json"), "utf8")).version,
	).toBe("2.0.0")
	expect(await readFile(join(target, "vault", "data.bin"), "utf8")).toBe(
		"preserve",
	)
})
