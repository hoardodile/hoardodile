import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBackupEngine } from "@hoardodile/backup"
import { afterEach, expect, it, vi } from "vitest"
import {
	backupPassword,
	createDesktopRepositories,
} from "./desktop-repositories.ts"

const roots: string[] = []
afterEach(async () => {
	vi.restoreAllMocks()
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true })
})
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "hd-desktop-repositories-"))
	roots.push(root)
	const storageRoot = join(root, "library")
	const directory = join(storageRoot, "local", "protection")
	await mkdir(join(storageRoot, "versions"), { recursive: true })
	const engine = createBackupEngine({ cacheDir: join(directory, "cache") })
	const options = {
		directory,
		storageRoot,
		protectedPaths: [join(storageRoot, "versions"), join(storageRoot, "local")],
		engine,
	}
	const repositories = await createDesktopRepositories(options)
	const backup = join(root, "backup")
	await mkdir(backup)
	return { root, storageRoot, directory, engine, options, repositories, backup }
}

it("creates independent password and recovery-key credentials, opens a relocated copy and preserves the destination", async () => {
	const f = await fixture()
	const selection = await f.repositories.select(f.backup, "backup")
	const connected = await f.repositories.connect({
		selectionId: selection.id,
		purpose: "backup",
		password: "备份 password",
	})
	await f.repositories.activate(connected.entry.id)
	const original = f.repositories.active()!
	const key = await readFile(original.passwordFile, "utf8")
	expect(key).not.toBe("备份 password")
	await f.engine.checkRepository(original)
	const moved = join(f.root, "moved")
	await cp(f.backup, moved, { recursive: true })
	const picked = await f.repositories.select(moved, "restore")
	await expect(
		f.repositories.connect({
			selectionId: picked.id,
			purpose: "restore",
			credential: "wrong",
		}),
	).rejects.toThrow()
	expect(f.repositories.sources()).toHaveLength(0)
	const source = await f.repositories.connect({
		selectionId: picked.id,
		purpose: "restore",
		credential: "备份 password",
	})
	await f.engine.checkRepository(f.repositories.descriptor(source.entry))
	expect(f.repositories.active()).toEqual(original)
	const keySelection = await f.repositories.select(moved, "restore")
	const fromKey = await f.repositories.connect({
		selectionId: keySelection.id,
		purpose: "restore",
		credential: JSON.stringify({ format: "hoardodile-restic-v1", key }),
		credentialType: "key",
	})
	await f.engine.checkRepository(f.repositories.descriptor(fromKey.entry))
	const restarted = await createDesktopRepositories(f.options)
	expect(restarted.active()).toEqual(original)
	await f.repositories.release(source.entry.id)
	await expect(
		readFile(f.repositories.descriptor(source.entry).passwordFile),
	).rejects.toMatchObject({ code: "ENOENT" })
	await rename(f.backup, join(f.root, "offline"))
	await expect(
		f.repositories.identity(original, connected.entry.identity),
	).rejects.toMatchObject({ code: "repository_offline" })
	expect(f.repositories.active()).toEqual(original)
	await rename(join(f.root, "offline"), f.backup)
	await rm(original.passwordFile)
	const reconnect = await f.repositories.select(f.backup, "backup")
	const recovered = await f.repositories.connect({
		selectionId: reconnect.id,
		purpose: "backup",
		credential: "备份 password",
	})
	await f.engine.checkRepository(f.repositories.descriptor(recovered.entry))
}, 120_000)

it("keeps the random key and can finish password setup after an interrupted key addition", async () => {
	const f = await fixture()
	const selected = await f.repositories.select(f.backup, "backup")
	vi.spyOn(f.engine, "addPassword").mockRejectedValueOnce(
		new Error("interrupted"),
	)
	await expect(
		f.repositories.connect({
			selectionId: selected.id,
			purpose: "backup",
			password: "test-password",
		}),
	).rejects.toThrow("interrupted")
	expect(f.repositories.active()).toBeUndefined()
	const retry = await f.repositories.select(f.backup, "backup")
	expect(retry.exists).toBe(false)
	const connected = await f.repositories.connect({
		selectionId: selected.id,
		purpose: "backup",
		password: "test-password",
	})
	expect(connected.created).toBe(true)
	await f.engine.checkRepository(f.repositories.descriptor(connected.entry))
}, 60_000)

it("rejects unregistered, nonempty and overlapping folders including junction aliases", async () => {
	const f = await fixture()
	await expect(
		f.repositories.select(f.storageRoot, "backup"),
	).rejects.toMatchObject({ code: "invalid_repository_path" })
	await expect(
		f.repositories.select(join(f.storageRoot, "versions"), "backup"),
	).rejects.toThrow()
	const alias = join(f.root, "alias")
	await symlink(
		join(f.storageRoot, "versions"),
		alias,
		process.platform === "win32" ? "junction" : "dir",
	)
	await expect(f.repositories.select(alias, "backup")).rejects.toThrow()
	await writeFile(join(f.backup, "keep.txt"), "keep")
	await expect(f.repositories.select(f.backup, "backup")).rejects.toMatchObject(
		{ code: "repository_folder_not_empty" },
	)
	await expect(
		f.repositories.connect({
			selectionId: "unknown",
			purpose: "restore",
			credential: "password",
		}),
	).rejects.toMatchObject({ code: "selection_expired" })
	expect(backupPassword.safeParse("a\nbcdef").success).toBe(false)
})
